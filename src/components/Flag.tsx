// Country flag from the bundled flag-icons set (SVG, MIT). Windows can't render flag emoji.
const FLAGS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
    eager: true,
    query: '?url',
    import: 'default',
}) as Record<string, string>;

const BY_CODE: Record<string, string> = {};
for (const [path, url] of Object.entries(FLAGS)) {
    const code = path.split('/').pop()!.replace('.svg', '').toUpperCase();
    BY_CODE[code] = url;
}

interface FlagProps {
    /** ISO 3166-1 alpha-2 code; several codes / unknown → globe */
    code?: string | null;
    className?: string;
}

export default function Flag({ code, className = 'w-5 h-[15px]' }: FlagProps) {
    const cc = (code || '').trim().toUpperCase();
    const url = cc === 'UK' ? BY_CODE.GB : BY_CODE[cc];
    if (!url) {
        return (
            <span className={`${className} inline-flex items-center justify-center rounded-[3px] bg-zinc-100 text-zinc-400 shrink-0`} title="Несколько стран">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" strokeWidth={2} />
                    <path strokeWidth={2} d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
                </svg>
            </span>
        );
    }
    return (
        <img
            src={url}
            alt={cc}
            title={cc}
            className={`${className} rounded-[3px] object-cover shrink-0 ring-1 ring-black/10`}
            draggable={false}
        />
    );
}
