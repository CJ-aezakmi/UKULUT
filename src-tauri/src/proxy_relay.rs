use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// Local proxy relay: accepts connections on localhost without auth,
/// forwards them to the upstream proxy with authentication.
/// This is the approach used by GoLogin, Multilogin, etc.

#[derive(Clone)]
pub struct ProxyRelay {
    pub local_port: u16,
    upstream_host: String,
    upstream_port: u16,
    upstream_user: String,
    upstream_pass: String,
    upstream_scheme: String,
}

impl ProxyRelay {
    /// Create a new proxy relay. Returns the local port it's listening on.
    pub fn start(
        upstream_scheme: &str,
        upstream_host: &str,
        upstream_port: u16,
        upstream_user: &str,
        upstream_pass: &str,
    ) -> Result<Self, String> {
        // Find a free port
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind local proxy: {}", e))?;
        let local_port = listener.local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        let relay = ProxyRelay {
            local_port,
            upstream_host: upstream_host.to_string(),
            upstream_port,
            upstream_user: upstream_user.to_string(),
            upstream_pass: upstream_pass.to_string(),
            upstream_scheme: upstream_scheme.to_string(),
        };

        let relay_clone = relay.clone();

        // Spawn listener thread
        thread::spawn(move || {
            relay_clone.run_listener(listener);
        });

        Ok(relay)
    }

    fn run_listener(&self, listener: TcpListener) {
        for stream in listener.incoming() {
            match stream {
                Ok(client) => {
                    let relay = self.clone();
                    thread::spawn(move || {
                        if let Err(e) = relay.handle_client(client) {
                            #[cfg(debug_assertions)]
                            eprintln!("[ProxyRelay] Error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[ProxyRelay] Accept error: {}", e);
                }
            }
        }
    }

    fn handle_client(&self, mut client: TcpStream) -> Result<(), String> {
        client.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .map_err(|e| e.to_string())?;

        // Read the initial request from the client
        let mut buf = vec![0u8; 65536];
        let n = client.read(&mut buf).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            return Ok(());
        }

        let request = String::from_utf8_lossy(&buf[..n]);

        // Connect to upstream proxy
        let upstream_addr = format!("{}:{}", self.upstream_host, self.upstream_port);
        let mut upstream = TcpStream::connect(&upstream_addr)
            .map_err(|e| format!("Failed to connect to upstream {}: {}", upstream_addr, e))?;
        upstream.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .map_err(|e| e.to_string())?;

        // Build Proxy-Authorization header
        let auth = base64_encode(&format!("{}:{}", self.upstream_user, self.upstream_pass));
        let proxy_auth_header = format!("Proxy-Authorization: Basic {}", auth);

        if request.starts_with("CONNECT ") {
            // HTTPS CONNECT tunnel
            self.handle_connect(&request, &mut client, &mut upstream, &proxy_auth_header)?;
        } else {
            // HTTP request - inject auth header
            self.handle_http(&buf[..n], &mut client, &mut upstream, &proxy_auth_header)?;
        }

        Ok(())
    }

    fn handle_connect(
        &self,
        request: &str,
        client: &mut TcpStream,
        upstream: &mut TcpStream,
        proxy_auth_header: &str,
    ) -> Result<(), String> {
        // Extract the first line: CONNECT host:port HTTP/1.1
        let first_line = request.lines().next().unwrap_or("");

        // Send CONNECT to upstream with auth
        let connect_req = format!(
            "{}\r\n{}\r\nHost: {}\r\n\r\n",
            first_line,
            proxy_auth_header,
            first_line.split_whitespace().nth(1).unwrap_or(""),
        );

        upstream.write_all(connect_req.as_bytes())
            .map_err(|e| format!("Write CONNECT error: {}", e))?;

        // Read upstream response
        let mut resp_buf = vec![0u8; 4096];
        let n = upstream.read(&mut resp_buf)
            .map_err(|e| format!("Read CONNECT response error: {}", e))?;

        let resp = String::from_utf8_lossy(&resp_buf[..n]);

        if resp.contains("200") {
            // Tunnel established - tell client
            client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .map_err(|e| format!("Write 200 error: {}", e))?;

            // Bidirectional copy
            self.tunnel(client, upstream)?;
        } else {
            // Forward error to client
            client.write_all(&resp_buf[..n])
                .map_err(|e| format!("Write error response: {}", e))?;
        }

        Ok(())
    }

    fn handle_http(
        &self,
        request_bytes: &[u8],
        client: &mut TcpStream,
        upstream: &mut TcpStream,
        proxy_auth_header: &str,
    ) -> Result<(), String> {
        let request = String::from_utf8_lossy(request_bytes);

        // Inject Proxy-Authorization header before the first \r\n\r\n
        let modified = if let Some(pos) = request.find("\r\n") {
            let (first_line, rest) = request.split_at(pos);
            format!("{}\r\n{}{}", first_line, proxy_auth_header, rest)
        } else {
            format!("{}\r\n{}\r\n\r\n", request, proxy_auth_header)
        };

        // Send to upstream
        upstream.write_all(modified.as_bytes())
            .map_err(|e| format!("Write HTTP error: {}", e))?;

        // Forward response back to client
        self.tunnel(upstream, client)?;

        Ok(())
    }

    fn tunnel(&self, stream_a: &mut TcpStream, stream_b: &mut TcpStream) -> Result<(), String> {
        let mut a_clone = stream_a.try_clone().map_err(|e| e.to_string())?;
        let mut b_clone = stream_b.try_clone().map_err(|e| e.to_string())?;

        let mut a_to_b = stream_a.try_clone().map_err(|e| e.to_string())?;
        let mut b_to_a = stream_b.try_clone().map_err(|e| e.to_string())?;

        // a -> b
        let t1 = thread::spawn(move || {
            let mut buf = vec![0u8; 65536];
            loop {
                match a_clone.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if b_clone.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // b -> a
        let t2 = thread::spawn(move || {
            let mut buf = vec![0u8; 65536];
            loop {
                match b_to_a.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if a_to_b.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let _ = t1.join();
        let _ = t2.join();

        Ok(())
    }
}

/// Simple base64 encoding (no external dependency needed)
fn base64_encode(input: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}
