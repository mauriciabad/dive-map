/**
 * The ICGC habitat and substrate catalogues, transcribed from the v1r0 specs.
 * The raster value is the join key the vector layers carry; CODI_LPRE3 is the
 * published code and what the WFS returns.
 *
 * Two things a reader needs to know about this data. The spec's own confusion
 * matrix accepts 40% per-class accuracy for habitats and 70% for substrate, so
 * no single polygon's class is trustworthy on its own. And a polygon only has to
 * be 75% pure, so the named habitat is the majority, not the whole.
 */

/** How much a diver cares. Drives legend order and which classes get a label. */
export type Prominence = 'signature' | 'notable' | 'background' | 'infrastructure';

/**
 * The three languages a card prints. Both catalogues extend this, so a class that
 * drops one is a compile error here rather than a blank label on a boat.
 */
export interface Localised {
	readonly ca: string;
	readonly es: string;
	readonly en: string;
}

export interface HabitatClass extends Localised {
	readonly raster: number;
	/** CODI_LPRE3, or CODI_LPRE4 for the three EUNIS-4 classes. Absent for raster 30. */
	readonly code: string | undefined;
	/** Habitat of Community Interest code, where the class has one. */
	readonly hic: string | undefined;
	readonly prominence: Prominence;
	/** Basename in the Crosshead terrain set, resolved by the texture build step. */
	readonly texture: string;
}

export const HABITATS: readonly HabitatClass[] = [
	{
		raster: 1,
		code: '30102',
		ca: 'Roca infralitoral superior moderadament exposada',
		es: 'Roca infralitoral superior moderadamente expuesta',
		en: 'Upper infralittoral rock, moderately exposed',
		hic: '1170',
		prominence: 'notable',
		texture: 'ch_rock'
	},
	{
		raster: 2,
		code: '30103',
		ca: 'Roca infralitoral superior protegida',
		es: 'Roca infralitoral superior protegida',
		en: 'Upper infralittoral rock, sheltered',
		hic: '1170',
		prominence: 'notable',
		texture: 'ch_rock'
	},
	{
		raster: 3,
		code: '30104',
		ca: 'Roca infralitoral inferior',
		es: 'Roca infralitoral inferior',
		en: 'Lower infralittoral rock',
		hic: '1170',
		prominence: 'notable',
		texture: 'ch_rock'
	},
	{
		raster: 4,
		code: '30105',
		ca: 'Hàbitats singulars de la roca infralitoral',
		es: 'Hábitats singulares de roca infralitoral',
		en: 'Singular infralittoral rock habitats',
		hic: '1170',
		prominence: 'signature',
		texture: 'ch_rocks'
	},
	{
		raster: 5,
		code: '30201',
		ca: 'Roca circalitoral dominada per algues',
		es: 'Roca circalitoral dominada por algas',
		en: 'Circalittoral rock, algae-dominated',
		hic: '1170',
		prominence: 'notable',
		texture: 'ch_grass_weeds'
	},
	{
		raster: 6,
		code: '3020104',
		ca: "Coral·ligen amb dominància d'algues",
		es: 'Coralígeno con dominancia de algas',
		en: 'Coralligenous, algae-dominated',
		hic: '1170',
		prominence: 'signature',
		texture: 'ch_rocks'
	},
	{
		raster: 7,
		code: '30202',
		ca: 'Roca circalitoral dominada per invertebrats',
		es: 'Roca circalitoral dominada por invertebrados',
		en: 'Circalittoral rock, invertebrate-dominated',
		hic: '1170',
		prominence: 'notable',
		texture: 'ch_stone'
	},
	{
		raster: 8,
		code: '3020225',
		ca: "Coral·ligen amb dominància d'invertebrats",
		es: 'Coralígeno con dominancia de invertebrados',
		en: 'Coralligenous, invertebrate-dominated',
		hic: '1170',
		prominence: 'signature',
		texture: 'ch_cobblestone'
	},
	{
		raster: 9,
		code: '30301',
		ca: 'Túnels i coves semifosques',
		es: 'Túneles y cuevas semioscuras',
		en: 'Semi-dark tunnels and caves',
		hic: '8330',
		prominence: 'signature',
		texture: 'ch_dungeonvoid'
	},
	{
		raster: 10,
		code: '30302',
		ca: 'Túnels i coves fosques',
		es: 'Túneles y cuevas oscuras',
		en: 'Dark tunnels and caves',
		hic: '8330',
		prominence: 'signature',
		texture: 'ch_dungeonvoid'
	},
	{
		raster: 11,
		code: '30401',
		ca: 'Còdols i graves infralitorals i circalitorals',
		es: 'Cantos y gravas infralitorales y circalitorales',
		en: 'Infralittoral and circalittoral cobbles and gravel',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_cobblestone'
	},
	{
		raster: 12,
		code: '30402',
		ca: 'Sorres i sorres fangoses infralitorals i circalitorals',
		es: 'Arenas y arenas fangosas infralitorales y circalitorales',
		en: 'Infralittoral and circalittoral sand and muddy sand',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_sand'
	},
	{
		raster: 13,
		code: '30403',
		ca: 'Fangs i fangs sorrencs infralitorals i circalitorals',
		es: 'Fangos y fangos arenosos infralitorales y circalitorales',
		en: 'Infralittoral and circalittoral mud and sandy mud',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_dirt_mud'
	},
	{
		raster: 14,
		code: '30404',
		ca: 'Argiles terrígenes compactades infralitorals',
		es: 'Arcillas terrígenas compactadas infralitorales',
		en: 'Compacted infralittoral terrigenous clay',
		hic: '1130',
		prominence: 'background',
		texture: 'ch_dirt'
	},
	{
		raster: 15,
		code: '30405',
		ca: 'Fons detrítics biogènics infralitorals i circalitorals',
		es: 'Fondos detríticos biógenos infralitorales y circalitorales',
		en: 'Infralittoral and circalittoral biogenic detritic bottoms',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_sandy'
	},
	{
		raster: 16,
		code: '3040506',
		ca: 'Fons de grapissar (maerl)',
		es: 'Fondos de maërl',
		en: 'Maerl beds',
		hic: undefined,
		prominence: 'signature',
		texture: 'ch_stones'
	},
	{
		raster: 17,
		code: '30504',
		ca: 'Alguers de Zostera noltii',
		es: 'Praderas de Zostera noltii',
		en: 'Zostera noltii beds',
		hic: undefined,
		prominence: 'notable',
		texture: 'ch_grass_2'
	},
	{
		raster: 18,
		code: '30509',
		ca: 'Alguers de Cymodocea nodosa de zones obertes, relativament profundes, sobre sorres',
		es: 'Praderas de Cymodocea nodosa de zonas abiertas profundas, sobre arenas',
		en: 'Cymodocea nodosa on open deeper sand',
		hic: undefined,
		prominence: 'notable',
		texture: 'ch_grass_3'
	},
	{
		raster: 19,
		code: '30510',
		ca: 'Alguers de Cymodocea nodosa de zones obertes poc profundes',
		es: 'Praderas de Cymodocea nodosa de zonas abiertas someras, sobre arena fangosa o mata muerta de Posidonia oceanica',
		en: 'Cymodocea nodosa on open shallow muddy sand or dead Posidonia matte',
		hic: undefined,
		prominence: 'notable',
		texture: 'ch_grass_3'
	},
	{
		raster: 20,
		code: '30512',
		ca: 'Alguers de Posidonia oceanica',
		es: 'Praderas de Posidonia oceanica',
		en: 'Posidonia oceanica meadows',
		hic: '1120*',
		prominence: 'signature',
		texture: 'ch_grass'
	},
	{
		raster: 21,
		code: '30513',
		ca: "Alguers en badies i llacunes i herbeis d'algues verdes rizomatoses",
		es: 'Praderas de fanerógamas y algas verdes rizomatosas',
		en: 'Bay and lagoon beds, rhizomatous green algae',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_grass_2_lines'
	},
	{
		raster: 22,
		code: '70101',
		ca: "Infraestructures d'aqüicultura",
		es: 'Infraestructuras acuícolas',
		en: 'Aquaculture infrastructure',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 23,
		code: '70102',
		ca: 'Conduccions i cables submarins',
		es: 'Conducciones y cables submarinos',
		en: 'Submarine pipes and cables',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 24,
		code: '70103',
		ca: 'Esculls artificials',
		es: 'Arrecifes artificiales',
		en: 'Artificial reefs',
		hic: undefined,
		prominence: 'signature',
		texture: 'ch_stones'
	},
	{
		raster: 25,
		code: '70104',
		ca: 'Derelictes',
		es: 'Pecios',
		en: 'Wrecks',
		hic: undefined,
		prominence: 'signature',
		texture: 'ch_shipwood'
	},
	{
		raster: 26,
		code: '70105',
		ca: 'Parcs eòlics marins',
		es: 'Parques eólicos marinos',
		en: 'Offshore wind farms',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 27,
		code: '70106',
		ca: 'Observatoris submarins permanents',
		es: 'Observatorios submarinos permanentes',
		en: 'Permanent underwater observatories',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 28,
		code: '70107',
		ca: 'Plataformes petrolíferes',
		es: 'Plataformas petrolíferas',
		en: 'Oil platforms',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 29,
		code: '70108',
		ca: 'Espigons i substrats durs de ports i marines',
		es: 'Sustrato duro portuario',
		en: 'Breakwaters and hard substrate of ports and marinas',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'ch_bluestones'
	},
	{
		raster: 30,
		code: undefined,
		ca: 'Espigons anti-erosió',
		es: 'Espigones antierosión',
		en: 'Anti-erosion groynes',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'ch_bluestones'
	},
	{
		raster: 31,
		code: '70109',
		ca: 'Boies i ancoratges',
		es: 'Fondeos y balizas',
		en: 'Buoys and moorings',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 32,
		code: '70201',
		ca: 'Fangs i sorres fangoses portuàries',
		es: 'Fangos y arenas fangosas portuarias',
		en: 'Harbour mud and muddy sand',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_dirt_dark'
	},
	{
		raster: 33,
		code: '70202',
		ca: 'Sorres i graves provinents de regeneració de platges',
		es: 'Gravas y arenas de rellenos artificiales',
		en: 'Sand and gravel from beach replenishment',
		hic: undefined,
		prominence: 'background',
		texture: 'ch_sandy_lines_02'
	}
];

export interface SubstrateClass extends Localised {
	readonly raster: number;
	readonly code: string;
	readonly texture: string;
}

export const SUBSTRATES: readonly SubstrateClass[] = [
	{ raster: 1, code: '301', ca: 'Roca', es: 'Roca', en: 'Rock', texture: 'ch_rock' },
	{
		raster: 2,
		code: '302',
		ca: 'Roca parcialment recoberta per sediments',
		es: 'Roca parcialmente cubierta por sedimentos',
		en: 'Rock partly covered by sediment',
		texture: 'ch_rocks'
	},
	{
		raster: 3,
		code: '30404',
		ca: 'Argiles terrígenes compactades infralitorals',
		es: 'Arcillas terrígenas compactadas infralitorales',
		en: 'Compacted infralittoral terrigenous clay',
		texture: 'ch_dirt'
	},
	{
		raster: 4,
		code: '30202',
		ca: 'Esculls biogènics',
		es: 'Arrecifes biógenos',
		en: 'Biogenic reefs',
		texture: 'ch_cobblestone'
	},
	{
		raster: 5,
		code: '30401',
		ca: 'Sediments grollers (còdols i graves)',
		es: 'Sedimentos gruesos (cantos y gravas)',
		en: 'Coarse sediment (cobbles and gravel)',
		texture: 'ch_cobblestone'
	},
	{
		raster: 6,
		code: '30402',
		ca: 'Arena i arena fangosa',
		es: 'Arena y arena fangosa',
		en: 'Sand and muddy sand',
		texture: 'ch_sand'
	},
	{
		raster: 7,
		code: '30403',
		ca: 'Fangs i fangs sorrencs',
		es: 'Fangos y fangos arenosos',
		en: 'Mud and sandy mud',
		texture: 'ch_dirt_mud'
	},
	{
		raster: 8,
		code: '30405',
		ca: 'Sediments mixtes',
		es: 'Sedimentos mixtos',
		en: 'Mixed sediment',
		texture: 'ch_sandy'
	},
	{
		raster: 9,
		code: '701',
		ca: 'Rocós antròpic',
		es: 'Sustrato duro artificial',
		en: 'Anthropogenic rock',
		texture: 'ch_bluestones'
	},
	{
		raster: 10,
		code: '70102a',
		ca: 'Emissaris i altres conduccions',
		es: 'Emisarios y otras conducciones',
		en: 'Outfalls and other pipelines',
		texture: 'metal'
	},
	{ raster: 11, code: '70102b', ca: 'Cables', es: 'Cables', en: 'Cables', texture: 'metal' },
	{
		raster: 12,
		code: '70103',
		ca: 'Esculls (biòtops) artificials',
		es: 'Arrecifes artificiales',
		en: 'Artificial reefs',
		texture: 'ch_stones'
	},
	{
		raster: 13,
		code: '70104',
		ca: 'Derelictes',
		es: 'Pecios',
		en: 'Wrecks',
		texture: 'ch_shipwood'
	},
	{
		raster: 14,
		code: '70107',
		ca: 'Instal·lacions petrolieres',
		es: 'Instalaciones petrolíferas',
		en: 'Oil installations',
		texture: 'metal'
	},
	{
		raster: 15,
		code: '70109',
		ca: 'Morts de boies i ancoratges',
		es: 'Muertos de boyas y fondeos',
		en: 'Mooring blocks and anchorages',
		texture: 'metal'
	},
	{
		raster: 16,
		code: '70101',
		ca: "Infraestructures d'aqüicultura",
		es: 'Infraestructuras acuícolas',
		en: 'Aquaculture infrastructure',
		texture: 'metal'
	},
	{
		raster: 17,
		code: '70106',
		ca: 'Observatoris científics permanents',
		es: 'Observatorios científicos permanentes',
		en: 'Permanent scientific observatories',
		texture: 'metal'
	},
	{
		raster: 18,
		code: '702',
		ca: "Fons sedimentaris d'origen antròpic",
		es: 'Sustrato sedimentario artificial',
		en: 'Anthropogenic sedimentary bottoms',
		texture: 'ch_dirt_dark'
	},
	{
		raster: 19,
		code: '702a',
		ca: "Fons sedimentaris d'origen antròpic (abocaments)",
		es: 'Sustrato sedimentario artificial (vertidos)',
		en: 'Anthropogenic sedimentary bottoms (dumping)',
		texture: 'ch_dirt_dark'
	},
	{
		raster: 20,
		code: '702b',
		ca: "Fons sedimentaris d'origen antròpic (rases de dragatge)",
		es: 'Sustrato sedimentario artificial (zanjas de dragado)',
		en: 'Anthropogenic sedimentary bottoms (dredge trenches)',
		texture: 'ch_dirt_lines_02'
	}
];

/**
 * CODI_FONS invents 70102a, 70102b, 702a and 702b outside the LPRE scheme, and
 * the substrate spec maps both 70103 and 70104 onto 070104, so habitat and
 * substrate cannot be joined by string equality. Look up instead.
 */
export const habitatByCode: ReadonlyMap<string, HabitatClass> = new Map(
	HABITATS.flatMap((h) => (h.code === undefined ? [] : [[h.code, h] as const]))
);

export const substrateByCode: ReadonlyMap<string, SubstrateClass> = new Map(
	SUBSTRATES.map((s) => [s.code, s] as const)
);

export const PROMINENCE_ORDER: readonly Prominence[] = [
	'signature',
	'notable',
	'background',
	'infrastructure'
];

/** Legend entries a card shows, most diver-relevant first, capped for A3 legibility. */
export const legendFor = (present: ReadonlySet<string>, limit: number): readonly HabitatClass[] =>
	HABITATS.filter((h) => h.code !== undefined && present.has(h.code))
		.sort(
			(a, b) =>
				PROMINENCE_ORDER.indexOf(a.prominence) - PROMINENCE_ORDER.indexOf(b.prominence) ||
				a.raster - b.raster
		)
		.slice(0, limit);

/**
 * The published substrate catalogue and the published habitat catalogue are
 * separate documents, but the live WFS does not respect the split: the substrate
 * layer returns 30509, 30512 and 30513, which are seagrass classes defined only
 * in the habitat catalogue. Resolve against both.
 */
export type SeabedClass = HabitatClass | SubstrateClass;

export const seabedClassByCode = (code: string): SeabedClass | undefined =>
	substrateByCode.get(code) ?? habitatByCode.get(code);

export const textureForCode = (code: string): string | undefined =>
	seabedClassByCode(code)?.texture;
