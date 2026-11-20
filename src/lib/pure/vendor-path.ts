/** The vendor's side of the app is `/v` and below: no sign-in, no Flow PT, no production chrome. */
export function isVendorPath(pathname: string): boolean {
	return pathname === '/v' || pathname.startsWith('/v/');
}
