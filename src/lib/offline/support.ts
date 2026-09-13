/**
 * The service worker API, or undefined where there is none.
 *
 * `lib.dom` types `navigator.serviceWorker` as always present and
 * `'serviceWorker' in navigator` answers true wherever the property is declared,
 * which is everywhere. The value is undefined outside a secure context, in
 * Safari private browsing, and in several embedded webviews, so both of the
 * obvious guards pass and the next property read throws. That is what the live
 * site reported as "Cannot read properties of undefined (reading 'register')".
 *
 * Someone opening a link from a message on a boat lands in exactly those
 * browsers. Offline does not apply there and cannot be made to, so the answer is
 * to detect the absence rather than to work around it.
 */
export const serviceWorkerContainer = (target: Navigator): ServiceWorkerContainer | undefined =>
	(target as Partial<Pick<Navigator, 'serviceWorker'>>).serviceWorker;
