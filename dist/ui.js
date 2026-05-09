const isTTY = process.stdout.isTTY === true;
const wrap = (open, close) => (s) => (isTTY ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const c = {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    green: wrap("32", "39"),
    red: wrap("31", "39"),
    yellow: wrap("33", "39"),
    cyan: wrap("36", "39"),
};
export function section(title) {
    process.stdout.write(`\n${c.bold(title)}\n`);
}
export function kv(key, value) {
    const padded = key.padEnd(18);
    process.stdout.write(`  ${c.dim(padded)} ${value}\n`);
}
export function line(text = "") {
    process.stdout.write(`${text}\n`);
}
//# sourceMappingURL=ui.js.map