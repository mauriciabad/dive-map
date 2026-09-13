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

/** The two ground layers. The state, the style and the legend all mean this by it. */
export type Ground = 'habitats' | 'substrate';

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
	/**
	 * Which catalogue this class belongs to. Carried rather than passed around,
	 * because both catalogues number their rasters from 1 and a caller that has to
	 * remember which list a class came out of will eventually hand over the wrong
	 * one. It is what makes `seabedKey` total.
	 */
	readonly ground: Ground;
	/**
	 * CODI_LPRE3, or CODI_LPRE4 for the three EUNIS-4 classes.
	 *
	 * Not unique. The survey publishes raster 29 and raster 30 both as 70108, so
	 * two rows here answer to one code; `sharersOf` below is what the rest of the
	 * app reads that off. Required, because the style and the legend can only key
	 * by code: a class with none would be painted by the fallback and never named,
	 * which is how the anti-erosion groynes spent a release unreachable. The type
	 * is what holds that line now.
	 */
	readonly code: string;
	/** Habitat of Community Interest code, where the class has one. */
	readonly hic: string | undefined;
	readonly prominence: Prominence;
	/** Basename in the Crosshead terrain set, resolved by the texture build step. */
	readonly texture: string;
}

export const HABITATS: readonly HabitatClass[] = [
	{
		raster: 1,
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
		// The same 70108 as raster 29. Both sets of polygons come back from the WFS
		// under it, 162 groynes against 115 port structures, and only NOM_LPRE3 tells
		// them apart. The tiles carry the code and drop the name.
		code: '70108',
		ca: 'Espigons anti-erosió',
		es: 'Espigones antierosión',
		en: 'Anti-erosion groynes',
		hic: undefined,
		prominence: 'infrastructure',
		texture: 'ch_bluestones'
	},
	{
		raster: 31,
		ground: 'habitats',
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
		ground: 'habitats',
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
		ground: 'habitats',
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
	readonly ground: Ground;
	readonly code: string;
	/**
	 * Editorial, not published: the substrate spec has no such field. Each value is
	 * the one carried by the habitat class with the same published code, and where
	 * no habitat shares the code, the one carried by its nearest twin.
	 */
	readonly prominence: Prominence;
	/**
	 * What the bottom is made of, which is a different question from what lives on
	 * it. So these name a material and no sediment or rock class borrows a habitat
	 * texture: the two catalogues once agreed on all five codes they publish in
	 * common, and a diver who switched to seafloor type got the same picture back.
	 * `metal` and `ch_shipwood` are the exceptions, because a pipe and a wreck are
	 * made of the same thing in either catalogue.
	 */
	readonly texture: string;
}

export const SUBSTRATES: readonly SubstrateClass[] = [
	{
		raster: 1,
		ground: 'substrate',
		code: '301',
		ca: 'Roca',
		es: 'Roca',
		en: 'Rock',
		prominence: 'notable',
		texture: 'ch_grayrock'
	},
	{
		raster: 2,
		ground: 'substrate',
		code: '302',
		ca: 'Roca parcialment recoberta per sediments',
		es: 'Roca parcialmente cubierta por sedimentos',
		en: 'Rock partly covered by sediment',
		prominence: 'notable',
		texture: 'ch_stone_pattern'
	},
	{
		raster: 3,
		ground: 'substrate',
		code: '30404',
		ca: 'Argiles terrígenes compactades infralitorals',
		es: 'Arcillas terrígenas compactadas infralitorales',
		en: 'Compacted infralittoral terrigenous clay',
		prominence: 'background',
		texture: 'ch_marble'
	},
	{
		raster: 4,
		ground: 'substrate',
		code: '30202',
		ca: 'Esculls biogènics',
		es: 'Arrecifes biógenos',
		en: 'Biogenic reefs',
		prominence: 'signature',
		texture: 'ch_sandstone'
	},
	{
		raster: 5,
		ground: 'substrate',
		code: '30401',
		ca: 'Sediments grollers (còdols i graves)',
		es: 'Sedimentos gruesos (cantos y gravas)',
		en: 'Coarse sediment (cobbles and gravel)',
		prominence: 'background',
		texture: 'ch_cobbles'
	},
	{
		raster: 6,
		ground: 'substrate',
		code: '30402',
		ca: 'Arena i arena fangosa',
		es: 'Arena y arena fangosa',
		en: 'Sand and muddy sand',
		prominence: 'background',
		texture: 'ch_dirt_lines_02'
	},
	{
		raster: 7,
		ground: 'substrate',
		code: '30403',
		ca: 'Fangs i fangs sorrencs',
		es: 'Fangos y fangos arenosos',
		en: 'Mud and sandy mud',
		prominence: 'background',
		texture: 'ch_sewers'
	},
	{
		raster: 8,
		ground: 'substrate',
		code: '30405',
		ca: 'Sediments mixtes',
		es: 'Sedimentos mixtos',
		en: 'Mixed sediment',
		prominence: 'background',
		texture: 'ch_tiled'
	},
	{
		raster: 9,
		ground: 'substrate',
		code: '701',
		ca: 'Rocós antròpic',
		es: 'Sustrato duro artificial',
		en: 'Anthropogenic rock',
		prominence: 'infrastructure',
		texture: 'ch_tiles_big'
	},
	{
		raster: 10,
		ground: 'substrate',
		code: '70102a',
		ca: 'Emissaris i altres conduccions',
		es: 'Emisarios y otras conducciones',
		en: 'Outfalls and other pipelines',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 11,
		ground: 'substrate',
		code: '70102b',
		ca: 'Cables',
		es: 'Cables',
		en: 'Cables',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 12,
		ground: 'substrate',
		code: '70103',
		ca: 'Esculls (biòtops) artificials',
		es: 'Arrecifes artificiales',
		en: 'Artificial reefs',
		prominence: 'signature',
		texture: 'ch_tiles'
	},
	{
		raster: 13,
		ground: 'substrate',
		code: '70104',
		ca: 'Derelictes',
		es: 'Pecios',
		en: 'Wrecks',
		prominence: 'signature',
		texture: 'ch_shipwood'
	},
	{
		raster: 14,
		ground: 'substrate',
		code: '70107',
		ca: 'Instal·lacions petrolieres',
		es: 'Instalaciones petrolíferas',
		en: 'Oil installations',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 15,
		ground: 'substrate',
		code: '70109',
		ca: 'Morts de boies i ancoratges',
		es: 'Muertos de boyas y fondeos',
		en: 'Mooring blocks and anchorages',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 16,
		ground: 'substrate',
		code: '70101',
		ca: "Infraestructures d'aqüicultura",
		es: 'Infraestructuras acuícolas',
		en: 'Aquaculture infrastructure',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 17,
		ground: 'substrate',
		code: '70106',
		ca: 'Observatoris científics permanents',
		es: 'Observatorios científicos permanentes',
		en: 'Permanent scientific observatories',
		prominence: 'infrastructure',
		texture: 'metal'
	},
	{
		raster: 18,
		ground: 'substrate',
		code: '702',
		ca: "Fons sedimentaris d'origen antròpic",
		es: 'Sustrato sedimentario artificial',
		en: 'Anthropogenic sedimentary bottoms',
		prominence: 'background',
		texture: 'ch_bluerock'
	},
	{
		raster: 19,
		ground: 'substrate',
		code: '702a',
		ca: "Fons sedimentaris d'origen antròpic (abocaments)",
		es: 'Sustrato sedimentario artificial (vertidos)',
		en: 'Anthropogenic sedimentary bottoms (dumping)',
		prominence: 'background',
		texture: 'ch_bluerock'
	},
	{
		raster: 20,
		ground: 'substrate',
		code: '702b',
		ca: "Fons sedimentaris d'origen antròpic (rases de dragatge)",
		es: 'Sustrato sedimentario artificial (zanjas de dragado)',
		en: 'Anthropogenic sedimentary bottoms (dredge trenches)',
		prominence: 'background',
		texture: 'ch_bluerock'
	},
	// The three below are published by the live layer and not by the spec sheet.
	// 30509, 30512 and 30513 are 41% of its features, and the survey does say what
	// the bottom under them is: each feature carries a TEXTURA reading "fons rocós
	// recobert de sediment amb vegetació (Posidonia oceanica)" for 30512 and "fons
	// sedimentari amb substrat fi amb vegetació" for the other two, with GRUIX 10
	// and 25 cm against 100 for open sand and mud. So the material is known and
	// these are substrate classes, with the same material the spec's own 302 and
	// 30402 name. Names are the layer's own DES_FONS. The published raster grid
	// stops at 20 and these have no raster in it, so they are numbered on after it:
	// nothing joins substrate by raster, the tiles carry CODI_FONS, and the number
	// is only the half of `seabedKey` that keeps a saved texture choice resolving.
	{
		raster: 21,
		ground: 'substrate',
		code: '30509',
		ca: 'Fons coberts per Cymodocea nodosa',
		es: 'Fondos cubiertos por Cymodocea nodosa',
		en: 'Bottom covered by Cymodocea nodosa',
		prominence: 'notable',
		texture: 'ch_dirt_lines_02'
	},
	{
		raster: 22,
		ground: 'substrate',
		code: '30512',
		ca: 'Fons coberts per Posidonia oceanica',
		es: 'Fondos cubiertos por Posidonia oceanica',
		en: 'Bottom covered by Posidonia oceanica',
		prominence: 'signature',
		texture: 'ch_stone_pattern'
	},
	{
		raster: 23,
		ground: 'substrate',
		code: '30513',
		ca: "Fons coberts per alguers i herbeis d'algues verdes rizomatoses",
		es: 'Fondos cubiertos por praderas y herbazales de algas verdes rizomatosas',
		en: 'Bottom covered by seagrass and rhizomatous green algae beds',
		prominence: 'background',
		texture: 'ch_dirt_lines_02'
	}
];

/**
 * CODI_FONS invents 70102a, 70102b, 702a and 702b outside the LPRE scheme, and
 * the substrate spec maps both 70103 and 70104 onto 070104, so habitat and
 * substrate cannot be joined by string equality. Look up instead.
 *
 * The first row published under a code is the one that code resolves to. `new Map`
 * would keep the last, so adding the finer of two rows that share a code would
 * quietly rename a class a printed card already names. 70108 has resolved to the
 * port structures since the first sheet was printed and it still does.
 */
export const habitatByCode: ReadonlyMap<string, HabitatClass> = HABITATS.reduce(
	(found, h) => (found.has(h.code) ? found : found.set(h.code, h)),
	new Map<string, HabitatClass>()
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

/** The one legend order: how much a diver cares, then the catalogue's own order. */
export const byProminence = (a: SeabedClass, b: SeabedClass): number =>
	PROMINENCE_ORDER.indexOf(a.prominence) - PROMINENCE_ORDER.indexOf(b.prominence) ||
	a.raster - b.raster;

/** Legend entries a card shows, most diver-relevant first, capped for A3 legibility. */
export const legendFor = (present: ReadonlySet<string>, limit: number): readonly HabitatClass[] =>
	HABITATS.filter((h) => present.has(h.code))
		.sort(byProminence)
		.slice(0, limit);

export type SeabedClass = HabitatClass | SubstrateClass;

/**
 * What a code means, decided by the layer that drew it.
 *
 * A code alone is not an answer. Habitat 30202 is circalittoral rock dominated by
 * invertebrates and substrate 30202 is a biogenic reef, and both catalogues now
 * publish 30509, 30512 and 30513. The ground is the other half, which is the rule
 * `patternFor` and `buildLegend` already paint and list by, so a card naming a tap
 * follows it too rather than answering for the layer nobody is looking at.
 *
 * Still falls through to the other catalogue, because each layer returns a handful
 * of codes only the other defines.
 */
export const seabedClassByCode = (code: string, ground: Ground): SeabedClass | undefined =>
	ground === 'substrate'
		? (substrateByCode.get(code) ?? habitatByCode.get(code))
		: (habitatByCode.get(code) ?? substrateByCode.get(code));

export const catalogueOf = (ground: Ground): readonly SeabedClass[] =>
	ground === 'habitats' ? HABITATS : SUBSTRATES;

/**
 * One class, named so it survives being written to a device and read back.
 *
 * Both catalogues number their rasters from 1, so the raster alone is ambiguous
 * and the published code is worse: habitat 30202 is circalittoral rock dominated
 * by invertebrates and substrate 30202 is a biogenic reef. The catalogue and the
 * raster together are the only pair that means one thing, and both come off the
 * published spec, so a key written last season still resolves next season.
 */
export type SeabedKey = `${Ground}-${number}`;

export const seabedKey = (seabed: SeabedClass): SeabedKey => `${seabed.ground}-${seabed.raster}`;

const CLASS_KEYS: ReadonlySet<string> = new Set([...HABITATS, ...SUBSTRATES].map(seabedKey));

/** Whether a string off a stored blob names a class this version of the catalogue has. */
export const isSeabedKey = (value: string): value is SeabedKey => CLASS_KEYS.has(value);

/**
 * What a diver chose to paint each class with, over the top of the catalogue.
 *
 * A class with no entry keeps the texture the catalogue gives it, which is why
 * this is the whole of the saved state rather than a copy of all 53 classes: a
 * configuration saved today still follows the catalogue for everything the diver
 * did not touch.
 */
export type TextureChoices = Readonly<Record<SeabedKey, string>>;

export const NO_TEXTURE_CHOICES: TextureChoices = {};

/**
 * The other classes of the same ground published under the same code.
 *
 * A vector tile carries the code and nothing else, so rows that share one are a
 * single thing to the map however many the catalogue gives them: 70108 is both the
 * port breakwaters and the anti-erosion groynes. Painting them apart is not
 * something the data can do.
 *
 * Grouped inside a catalogue and not across the two. Habitat 30202 is
 * circalittoral rock and substrate 30202 is a biogenic reef; they are different
 * ground layers, and the style already keeps the layer's own meaning.
 */
const CODE_SHARERS: ReadonlyMap<SeabedKey, readonly SeabedKey[]> = (() => {
	const groups = new Map<string, SeabedClass[]>();
	for (const seabed of [...HABITATS, ...SUBSTRATES]) {
		const at = `${seabed.ground}/${seabed.code}`;
		const found = groups.get(at);
		if (found === undefined) groups.set(at, [seabed]);
		else found.push(seabed);
	}
	const sharers = new Map<SeabedKey, readonly SeabedKey[]>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		for (const seabed of group) {
			sharers.set(seabedKey(seabed), group.filter((other) => other !== seabed).map(seabedKey));
		}
	}
	return sharers;
})();

/** Empty for all but the handful of classes that answer to a code somebody else also has. */
export const sharersOf = (seabed: SeabedClass): readonly SeabedKey[] =>
	CODE_SHARERS.get(seabedKey(seabed)) ?? [];

/**
 * What this class is painted with, which is what its code is painted with.
 *
 * A choice made for one class of a shared code carries to the others, because the
 * map has one pattern for the code either way. Without that, choosing a texture for
 * the groynes changed nothing at all and choosing one for the port structures
 * repainted the groynes with it, and neither said so.
 */
export const textureOf = (seabed: SeabedClass, chosen: TextureChoices): string => {
	const own = chosen[seabedKey(seabed)];
	if (own !== undefined) return own;
	for (const sharer of sharersOf(seabed)) {
		const shared = chosen[sharer];
		if (shared !== undefined) return shared;
	}
	return seabed.texture;
};

/** The same choices with one class put back on whatever its catalogue gives it. */
export const withoutChoice = (chosen: TextureChoices, key: SeabedKey): TextureChoices => {
	const kept: Record<SeabedKey, string> = {};
	for (const [at, texture] of Object.entries(chosen)) {
		if (at !== key && isSeabedKey(at)) kept[at] = texture;
	}
	return kept;
};

/**
 * The hatch the style paints over ground the habitat survey never classified.
 *
 * It is generated by the texture build rather than taken from the pack, so no
 * real class can be confused with it, and it is not a class itself: the picker
 * never offers it and no diver can choose it. It lives here rather than beside
 * the map's loaders because the offline cache has to know to carry it, and a
 * second copy of the string is a hole in the seabed waiting to happen.
 */
export const UNSURVEYED_TEXTURE = 'unsurveyed';

/**
 * Every texture the two catalogues between them name. Thirty-one of them carry
 * fifty-three classes.
 *
 * This is what the map paints before anybody chooses anything, so it is what the
 * offline cache carries to the dock and what `texturePalette` registers on a
 * configuration with no choices in it.
 */
export const CATALOGUE_TEXTURES: readonly string[] = [
	...new Set([...HABITATS, ...SUBSTRATES].map((c) => c.texture))
];

/**
 * Every texture a class may be painted with, which is every texture the build
 * emits. Forty-nine of them, against the thirty-one the catalogues name.
 *
 * This list and the built set are the same set, and `habitat.spec.ts` reads
 * `static/textures/index.json` to hold them that way. A name here that the build
 * never emitted is a class painted with nothing, because a `fill-pattern` naming
 * an image the map has not registered is not an error in MapLibre: the fill
 * simply does not draw, and a hole in the seabed looks like deep water.
 *
 * It is deliberately wider than what MapLibre holds at any moment. `texturePalette`
 * registers the texture each class is actually painted with and nothing else, so
 * the registry holds the thirty-two the two catalogues name between them,
 * whatever the pack grows to. The picker's own grid is CSS background images at 256, which
 * the browser fetches on demand and evicts on its own, and never reaches
 * `addImage` at all.
 */
export const SEABED_TEXTURES: readonly string[] = [
	'ch_bluerock',
	'ch_bluestones',
	'ch_carpet',
	'ch_cobbles',
	'ch_cobblestone',
	'ch_dirt',
	'ch_dirt_dark',
	'ch_dirt_lines_02',
	'ch_dirt_mud',
	'ch_dungeonvoid',
	'ch_dungeonvoid_pattern',
	'ch_forest',
	'ch_grass',
	'ch_grass_2',
	'ch_grass_2_lines',
	'ch_grass_3',
	'ch_grass_weeds',
	'ch_grayrock',
	'ch_marble',
	'ch_rock',
	'ch_rocks',
	'ch_sand',
	'ch_sandstone',
	'ch_sandy',
	'ch_sandy_lines_02',
	'ch_sewers',
	'ch_shipwood',
	'ch_stone',
	'ch_stone_pattern',
	'ch_stones',
	'ch_swamp',
	'ch_tiled',
	'ch_tiles',
	'ch_tiles_big',
	'ch_water',
	'ch_waterblue',
	'ch_waterbluedark',
	'ch_waterbluelight',
	'ch_waterdark',
	'ch_waterdeep',
	'ch_watergreen',
	'ch_watergreendark',
	'ch_watergreenlight',
	'ch_weeds',
	'ch_wood',
	'ch_wood_interlaced',
	'ch_wood_pattern',
	'ch_wood_short',
	'metal'
];

const KNOWN_TEXTURES: ReadonlySet<string> = new Set(SEABED_TEXTURES);

export const isSeabedTexture = (value: string): boolean => KNOWN_TEXTURES.has(value);
