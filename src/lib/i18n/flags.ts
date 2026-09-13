import caFlag from 'flag-icons/flags/4x3/es-ct.svg';
import enFlag from 'flag-icons/flags/4x3/gb.svg';
import esFlag from 'flag-icons/flags/4x3/es.svg';
import type { Locale } from './locale';

/**
 * The flag beside each language, from the `flag-icons` set rather than drawn
 * here. A flag is its colours, and the authored icons are one stroke weight in
 * one ink: a senyera and a bandera reduced to that are the same four bars, which
 * is a drawing that tells a diver nothing.
 *
 * Three files are imported by name, so the build emits three and not the
 * thousand the package ships. Vite resolves each to a URL under the deployment's
 * own base, which is what keeps them working on a boat with no signal and on a
 * site that is not served from a root.
 *
 * Catalan takes `es-ct`, the senyera, because the language of this coast has no
 * country code. English takes `gb`, which is the flag the set has for it.
 */
export const FLAGS: Record<Locale, string> = { ca: caFlag, es: esFlag, en: enFlag };
