// Print-one-element helper: temporarily marks an element as the only visible
// node so `window.print()` (and "Save as PDF") captures just that panel.
// Paired with the `body.printing-area` rules in layout.css.

export function printElement(selector: string): void {
	const el = document.querySelector(selector);
	if (!el) {
		window.print();
		return;
	}
	document.body.classList.add('printing-area');
	el.classList.add('print-area');
	try {
		window.print();
	} finally {
		el.classList.remove('print-area');
		document.body.classList.remove('printing-area');
	}
}
