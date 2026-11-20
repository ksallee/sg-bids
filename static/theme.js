// The scheme, before the first paint, from the key $lib/theme writes. A file of its own, not an
// inline script: the prerendered pages (CSP hashes) and the others (CSP nonces) load it alike, and
// a prerendered page cannot carry a nonce.
(function () {
	try {
		var root = document.documentElement;
		var mode = localStorage.getItem('sg-bids:mode') || 'system';
		var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
		root.classList.toggle('dark', dark);
		root.style.colorScheme = dark ? 'dark' : 'light';
	} catch (e) {}
})();
