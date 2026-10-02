// The chat's tiny markdown: code blocks, inline code, bold and line breaks. Escapes first.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
export const md = (s: string) =>
  esc(s)
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
