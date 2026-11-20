/** Today in this browser's time zone, `YYYY-MM-DD`: the day a due date is checked against. */
export function today(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
