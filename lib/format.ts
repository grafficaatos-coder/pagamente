export const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export const dateBR = (iso?: string) => {
  if (!iso) return '—';
  const value = iso.slice(0, 10);
  const [y, m, d] = value.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export const dateTimeBR = (iso?: string) => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
};

export const parseBRL = (value: string) => {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};
