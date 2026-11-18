export type Translate = (key: string) => string;
export const trafficBands = [
  { minimum: 1, maximum: 9, label: '1–9', color: '#8296a6' },
  { minimum: 10, maximum: 99, label: '10–99', color: '#3a9c8a' },
  { minimum: 100, maximum: 999, label: '100–999', color: '#d09330' },
  { minimum: 1000, maximum: Infinity, label: '≥1000', color: '#c1534b' },
];

export function processLabel(name: string) {
  const [process, identity] = name.split(' [upid ');
  const lines: string[] = [];
  let current = '';
  for (const segment of process.split(/(?<=[./:])/)) {
    if (current && current.length + segment.length > 18) {
      lines.push(current);
      current = '';
    }
    for (const chunk of segment.match(/.{1,18}/g) || []) {
      if (current.length + chunk.length > 18) {
        lines.push(current);
        current = '';
      }
      current += chunk;
    }
  }
  if (current) lines.push(current);
  if (identity) lines.push(`[upid ${identity}`);
  return lines.join('\n');
}

export function imageTool(translate: Translate, name: string) {
  return {
    type: 'svg',
    title: translate('saveChart'),
    name,
    backgroundColor: '#fffefa',
  };
}
