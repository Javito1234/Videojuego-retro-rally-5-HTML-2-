'use strict';
// ============================================================================
// RETRO RALLY 5 - CAMPEONATO, RALLY, CARRERA INDIVIDUAL Y CONTRARRELOJ
// Quinto juego de la saga: 12 circuitos con vueltas + 12 etapas punto a punto, todos con túneles y puentes,
// rivales de IA, daño, copiloto, y 4 modos: campeonato, rally individual, carrera individual y contrarreloj con sombra.
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const WIDTH = 800, HEIGHT = 450;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const STEP = 1 / 60;
const SEG_LEN = 200;          // largo de cada segmento de ruta (unidades de mundo)
const ROAD_W = 2000;          // semiancho de la ruta
const RUMBLE_LEN = 3;
const LANES = 3;
const DRAW_DIST = 240;        // segmentos que se dibujan hacia adelante
const CAM_DEPTH = 0.84;
const CAM_H = 1000;
const PLAYER_Z = CAM_H * CAM_DEPTH;   // el auto va "adelante" de la cámara
const KMH_WORLD = 45;         // unidades de mundo por segundo por cada km/h
const M_PER_UNIT = 0.00617;   // metros por unidad de mundo
const RUNOUT_SEGS = 160;      // tramo de frenado después de la meta (solo etapas)
const BARRIER_X = 2.3;        // valla lateral en campo abierto
const TUNNEL_X = 1.14;        // pared del túnel (en semianchos de ruta)
const BRIDGE_X = 1.07;        // baranda del puente
const TUNNEL_H = 2200;        // alto del túnel (unidades de mundo)
const RAIL_H = 430;           // alto de la baranda del puente
const ACCENT = '#ffc83d';     // color de acento de la quinta entrega

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
const easeInOut = (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);

function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}


function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = function (sh) { return Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); };
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// ---------------------------------------------------------------------------
// DATOS: vehículos, superficies, temas, dificultad y pruebas
// ---------------------------------------------------------------------------
const carImgs = ['escarabajo.png', 'coupe.png', 'hypercar.png'].map(function (n) {
    const im = new Image(); im.src = n; return im;
});

// top = km/h máx. | a0 = aceleración base (km/h por seg) | brake = frenada | steer = respuesta de dirección
// surf = multiplicador de agarre por superficie (el Hypercar vuela en asfalto y sufre en nieve)
const VEHICLES = [
    { name: 'VW Escarabajo', top: 172, a0: 33, brake: 120, steer: 2.25, surf: { asphalt: 0.95, gravel: 1.12, snow: 1.05 }, rpmMax: 5600, pulses: 2, tone: 0.55 },
    { name: 'Coupé GT',      top: 205, a0: 42, brake: 135, steer: 2.35, surf: { asphalt: 1.00, gravel: 1.00, snow: 1.00 }, rpmMax: 7000, pulses: 2, tone: 0.80 },
    { name: 'V12 Hypercar',  top: 242, a0: 58, brake: 150, steer: 2.45, surf: { asphalt: 1.06, gravel: 0.84, snow: 0.74 }, rpmMax: 8500, pulses: 3, tone: 1.10 }
];

const SURFACES = {
    asphalt: { name: 'ASFALTO', grip: 1.00, push: 1.00, accel: 1.00, brake: 1.00, top: 1.00, road: ['#4b4b50', '#444449'], rumble: ['#ffffff', '#d61f1f'], noiseF: 1400, noiseG: 0.030 },
    gravel:  { name: 'TIERRA',  grip: 0.74, push: 1.25, accel: 0.93, brake: 0.78, top: 0.92, road: ['#b58f5a', '#a9844f'], rumble: ['#8a6b3f', '#7a5c34'], noiseF: 900,  noiseG: 0.090 },
    snow:    { name: 'NIEVE',   grip: 0.56, push: 1.50, accel: 0.85, brake: 0.55, top: 0.84, road: ['#e2eaf3', '#d5e0ec'], rumble: ['#9db4cb', '#8aa5c0'], noiseF: 500,  noiseG: 0.040 }
};


const THEMES = {
    // Puerto de noche: ciudad iluminada, farolas y agua negra
    harbor: {
        skyTop: '#02030f', skyMid: '#10163a', skyBottom: '#2a2f66', mt1: '#0b0d24', mt2: '#151a3c',
        grass: ['#1b2433', '#161e2b'], fog: '#1d2350', fogD: 2.4,
        sun: { x: 0.74, y: 95, r: 22, color: '#e8f0ff' }, stars: true, skyline: true,
        deco: [{ k: 'lamp', w: 7 }, { k: 'bldg', w: 5 }, { k: 'bush', w: 1 }],
        water: ['#0b1b36', '#0e2342'], snowfall: false
    },
    // Cañón del desierto: mesas rojas, cactus y arena
    canyon: {
        skyTop: '#2c7be0', skyMid: '#7cc0f0', skyBottom: '#ffe9c4', mt1: '#c0663a', mt2: '#a24a2a',
        grass: ['#d9a066', '#cf9659'], fog: '#f2d3a8', fogD: 2.0,
        sun: { x: 0.30, y: 110, r: 28, color: '#fff3c4' }, stars: false, skyline: false,
        deco: [{ k: 'cactus', w: 5 }, { k: 'mesa', w: 3 }, { k: 'rock', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#2c6b8f', '#2a6385'], snowfall: false,
        surfColors: { gravel: { road: ['#d8b27c', '#cca66f'], rumble: ['#b98a52', '#a97d48'] } }
    },
    // Lago por la mañana: neblina, pinos y árboles de hoja ancha
    lake: {
        skyTop: '#7fa4c8', skyMid: '#b9d0e0', skyBottom: '#eef3f0', mt1: '#6f8fa6', mt2: '#4f7a5a',
        grass: ['#4f8f4a', '#478742'], fog: '#dfe8e6', fogD: 3.0,
        sun: { x: 0.62, y: 60, r: 24, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 4 }, { k: 'broadleaf', w: 4 }, { k: 'bush', w: 2 }, { k: 'rock', w: 1 }],
        water: ['#3e7f9e', '#397793'], snowfall: false
    },
    // Sierra alpina: picos nevados, pinos y prados
    alpine: {
        skyTop: '#1e6fd0', skyMid: '#6fb3ee', skyBottom: '#eaf6ff', mt1: '#d3deea', mt2: '#7390a8',
        grass: ['#6c9a52', '#648f4b'], fog: '#dcecf8', fogD: 2.2,
        sun: { x: 0.78, y: 120, r: 22, color: '#fffbe8' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 5 }, { k: 'snowpine', w: 2 }, { k: 'rock', w: 3 }, { k: 'bush', w: 1 }],
        water: ['#4a86b0', '#437ca3'], snowfall: false
    },
    // Selva húmeda: vegetación densa y tierra oscura
    jungle: {
        skyTop: '#3a7fb0', skyMid: '#9ccfa8', skyBottom: '#e5f3c9', mt1: '#4b7d63', mt2: '#2f5e48',
        grass: ['#2f7a35', '#2a712f'], fog: '#cfe8c0', fogD: 2.8,
        sun: { x: 0.45, y: 80, r: 26, color: '#fff7c4' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'palm', w: 3 }, { k: 'bush', w: 3 }],
        water: ['#6b5a3a', '#615233'], snowfall: false,
        surfColors: { gravel: { road: ['#8a6a46', '#7e5f3e'], rumble: ['#5a4128', '#4e3822'] } }
    },
    // Costa al atardecer: acantilados, mar violeta y sol bajo
    dusk: {
        skyTop: '#2a1450', skyMid: '#d6457a', skyBottom: '#ffb15a', mt1: '#3b2260', mt2: '#5a2c70',
        grass: ['#3c5a3e', '#365236'], fog: '#e08a8a', fogD: 2.4,
        sun: { x: 0.50, y: 25, r: 44, color: '#ffd9a0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 3 }, { k: 'bush', w: 3 }, { k: 'rock', w: 3 }],
        water: ['#2e3c78', '#283468'], snowfall: false
    },
    // Ciudad neón de noche: cielo violeta, rascacielos y farolas
    neon: {
        skyTop: '#05010f', skyMid: '#2a0a52', skyBottom: '#7a1f8f', mt1: '#1a0836', mt2: '#2a0f4d',
        grass: ['#1a1030', '#150c28'], fog: '#4a1a6e', fogD: 2.4,
        sun: { x: 0.35, y: 90, r: 26, color: '#ff7ad9' }, stars: true, skyline: true,
        deco: [{ k: 'lamp', w: 7 }, { k: 'bldg', w: 6 }, { k: 'bush', w: 1 }],
        water: ['#10143a', '#0c1030'], snowfall: false
    },
    // Otoño: hojas naranjas y rojizas, luz cálida
    autumn: {
        skyTop: '#3f6fb5', skyMid: '#e3a35a', skyBottom: '#ffe2b0', mt1: '#a8552a', mt2: '#7a3a1e',
        grass: ['#b5651d', '#a85a18'], fog: '#f0cf9c', fogD: 2.6,
        sun: { x: 0.70, y: 90, r: 26, color: '#fff0c0' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'pine', w: 2 }, { k: 'bush', w: 2 }, { k: 'rock', w: 1 }],
        water: ['#4a6e8a', '#436680'], snowfall: false,
        leaf: ['#b5470f', '#d9701c', '#e8a02a'], bushC: ['#a2561a', '#c47a24'],
        surfColors: { gravel: { road: ['#a97a4a', '#9c6f42'], rumble: ['#6e4a28', '#60401f'] } }
    },
    // Dunas: arena clara, cactus y palmeras
    dunes: {
        skyTop: '#4aa3e8', skyMid: '#bfe2f5', skyBottom: '#fff1c9', mt1: '#e0b46a', mt2: '#c99548',
        grass: ['#ecc57a', '#e2b96c'], fog: '#f6dcaa', fogD: 2.2,
        sun: { x: 0.55, y: 120, r: 30, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'cactus', w: 4 }, { k: 'rock', w: 3 }, { k: 'palm', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#2f8fb0', '#2a86a6'], snowfall: false,
        bushC: ['#8f9a3a', '#a8b04a'],
        surfColors: { gravel: { road: ['#d9b57a', '#cfa96d'], rumble: ['#b58a4c', '#a67d42'] } }
    },
    // Noche polar: nevada constante, luna y pinos cargados de nieve
    frost: {
        skyTop: '#020816', skyMid: '#0e2548', skyBottom: '#27508a', mt1: '#1c3354', mt2: '#2c4a73',
        grass: ['#dfe9f5', '#d3e0f0'], fog: '#25406b', fogD: 2.4,
        sun: { x: 0.25, y: 110, r: 20, color: '#cfe4ff' }, stars: true, skyline: false,
        deco: [{ k: 'snowpine', w: 6 }, { k: 'pine', w: 2 }, { k: 'rock', w: 2 }],
        water: ['#0f2a4a', '#0c2340'], snowfall: true
    },
    // Volcán: cielo rojizo, roca negra y lava en lugar de agua
    volcano: {
        skyTop: '#1a0606', skyMid: '#6a1a10', skyBottom: '#d4541f', mt1: '#2a0f0c', mt2: '#4a1a10',
        grass: ['#2b2220', '#241c1a'], fog: '#7a2a18', fogD: 2.2,
        sun: { x: 0.40, y: 70, r: 34, color: '#ff9a3c' }, stars: false, skyline: false,
        deco: [{ k: 'rock', w: 6 }, { k: 'mesa', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#c2410c', '#a8360a'], snowfall: false,
        bushC: ['#4a2a22', '#5e362b'],
        surfColors: { gravel: { road: ['#6b5a52', '#5f4f48'], rumble: ['#3a2e2a', '#322824'] } }
    },
    // Sakura: cerezos en flor, cielo claro y rosado
    sakura: {
        skyTop: '#6aa9e8', skyMid: '#f7cfe0', skyBottom: '#fff3f6', mt1: '#c98aa8', mt2: '#9a6a8a',
        grass: ['#6fae5a', '#67a553'], fog: '#f6dfe8', fogD: 2.8,
        sun: { x: 0.35, y: 90, r: 26, color: '#fff6d8' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'pine', w: 1 }, { k: 'bush', w: 3 }, { k: 'rock', w: 1 }],
        water: ['#5a8fb8', '#5385ad'], snowfall: false,
        leaf: ['#e58fb0', '#f2a9c4', '#f7c6d8'], bushC: ['#d9729a', '#ee93b4']
    },
    // Sabana: hierba dorada, cielo anaranjado y arbustos secos
    savanna: {
        skyTop: '#2f78d0', skyMid: '#f0b060', skyBottom: '#ffe0a0', mt1: '#b9803a', mt2: '#8f5f2a',
        grass: ['#c9a548', '#bf9b40'], fog: '#f2d49a', fogD: 2.2,
        sun: { x: 0.60, y: 60, r: 36, color: '#fff0b0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 2 }, { k: 'bush', w: 4 }, { k: 'rock', w: 3 }, { k: 'cactus', w: 1 }],
        water: ['#7a6a3a', '#6f6032'], snowfall: false,
        bushC: ['#8a8a2a', '#a3a33a'],
        surfColors: { gravel: { road: ['#c7a064', '#bb9558'], rumble: ['#8a6a3a', '#7c5e32'] } }
    },
    // Pantano: neblina verde oscura, árboles retorcidos y agua turbia
    swamp: {
        skyTop: '#34524a', skyMid: '#7c9a7a', skyBottom: '#c6d6b0', mt1: '#3a5a48', mt2: '#2a4638',
        grass: ['#3f5a2f', '#385228'], fog: '#a8bd9c', fogD: 3.2,
        sun: { x: 0.50, y: 130, r: 22, color: '#e8f0c0' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 5 }, { k: 'palm', w: 2 }, { k: 'bush', w: 4 }, { k: 'rock', w: 1 }],
        water: ['#3a4a2a', '#33422a'], snowfall: false,
        leaf: ['#2f5a2a', '#3a6a30', '#4a7a3a'], bushC: ['#35592b', '#44703a']
    }
};

// Dificultad (todos los valores son fracciones de la velocidad ideal de la etapa):
//  - rival: rango de ritmo de los 4 rivales de IA (siempre hay uno más rápido y uno más lento dentro del rango).
//  - allow: ritmo mínimo que alcanza para llegar a cada checkpoint (tiempo que suma cada uno).
// Las medallas NO dependen de estos números: se dan por posición de llegada (P1 oro, P2 plata, P3 bronce).
// NOTA: calibrado con simulación, no con jugadores reales: es lo primero a retocar.
const DIFFS = [
    { name: 'Fácil',   allow: 0.42, rival: [0.56, 0.68] },
    { name: 'Media',   allow: 0.50, rival: [0.68, 0.80] },
    { name: 'Difícil', allow: 0.58, rival: [0.78, 0.90] }
];
const MEDALS = ['ORO', 'PLATA', 'BRONCE'];
function medalForRank(rank) { return MEDALS[rank - 1] || 'SIN MEDALLA'; }


// ---------------------------------------------------------------------------
// LAS 6 PRUEBAS (orden del campeonato): 3 circuitos cerrados y 3 etapas punto a punto
// Circuito: pts = puntos de control del trazado (la pista sale de esa forma), hill = altura por fracción de vuelta
//           (en múltiplos de SEG_LEN), surfaces/tunnels/bridges = rangos como fracción de vuelta.
// Etapa:    sección = [entrada, tramo, salida, curva, desnivel, superficie?, rasgo?]  rasgo: 'T' túnel, 'B' puente
// ---------------------------------------------------------------------------
// @@EVENTS_BEGIN
const EVENTS = [
    // ===================== CIRCUITOS (0-11) =====================
    {
        kind: 'circuit', name: "Gran Premio de Sakura", short: "Sakura", theme: 'sakura', seed: 5004, laps: 3, N: 1678, surface: 'asphalt',
        pts: [[314,520],[420,525],[527,548],[633,600],[761,605],[889,529],[955,402],[920,271],[848,188],[792,98],[686,51],[580,96],[473,133],[367,134],[276,147],[211,184],[159,241],[174,317],[209,373],[218,484]],
        hill: [[0,0],[0.173,1],[0.319,6],[0.483,4],[0.643,-3],[0.844,0]],
        surfaces: [], tunnels: [[0.25,0.312]], bridges: [[0.658,0.72],[0.057,0.121]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo de la Sabana", short: "Sabana", theme: 'savanna', seed: 6004, laps: 3, N: 1497, surface: 'asphalt',
        pts: [[276,489],[376,497],[475,529],[574,516],[673,515],[776,499],[849,426],[898,347],[894,255],[808,216],[746,219],[674,181],[575,157],[475,167],[376,149],[277,121],[190,150],[115,206],[39,300],[62,423],[173,478]],
        hill: [[0,0],[0.145,4],[0.299,2],[0.415,-6],[0.574,5],[0.689,5],[0.843,-6]],
        surfaces: [], tunnels: [[0.13,0.212]], bridges: [[0.727,0.795]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito del Pantano", short: "Pantano", theme: 'swamp', seed: 7002, laps: 3, N: 1554, surface: 'asphalt',
        pts: [[449,560],[504,572],[560,568],[616,559],[671,551],[725,530],[777,510],[836,509],[906,504],[964,453],[974,380],[943,317],[894,275],[846,247],[806,208],[772,161],[731,123],[682,99],[633,110],[586,121],[533,111],[476,81],[415,50],[354,37],[297,50],[245,78],[193,103],[137,116],[72,126],[19,177],[36,249],[75,302],[115,352],[125,375],[153,397],[194,440],[239,477],[292,498],[345,516],[396,542]],
        hill: [[0,0],[0.152,7],[0.344,-5],[0.52,0],[0.658,0],[0.857,6]],
        surfaces: [], tunnels: [[0.614,0.678],[0.506,0.563]], bridges: [[0.062,0.113]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo del Lago Azul", short: "Lago Azul", theme: 'lake', seed: 8004, laps: 3, N: 1401, surface: 'asphalt',
        pts: [[265,477],[350,476],[435,464],[521,407],[606,341],[692,360],[768,433],[858,439],[912,367],[920,278],[882,199],[804,169],[735,162],[650,115],[565,68],[479,85],[394,109],[308,57],[190,-8],[67,75],[70,226],[108,319],[121,399],[181,460]],
        hill: [[0,0],[0.126,-6],[0.308,0],[0.449,6],[0.582,3],[0.702,-4],[0.872,2]],
        surfaces: [[0.569,0.71,'gravel']], tunnels: [[0.063,0.124]], bridges: [[0.817,0.872],[0.315,0.373]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito de la Selva Alta", short: "Selva Alta", theme: 'jungle', seed: 9000, laps: 3, N: 1461, surface: 'asphalt',
        pts: [[343,560],[390,573],[438,581],[486,581],[535,576],[585,567],[633,549],[673,519],[711,487],[749,453],[784,416],[814,365],[790,311],[735,299],[681,293],[629,284],[585,264],[551,228],[525,175],[502,118],[473,70],[430,43],[378,38],[318,43],[275,72],[241,100],[199,121],[153,141],[115,171],[89,213],[78,261],[71,302],[60,336],[55,384],[66,445],[94,496],[137,526],[197,523],[253,522],[298,542]],
        hill: [[0,0],[0.174,3],[0.317,2],[0.506,-6],[0.661,4],[0.81,3]],
        surfaces: [], tunnels: [[0.07,0.153],[0.789,0.843]], bridges: [[0.432,0.485]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Caldera", short: "Caldera", theme: 'volcano', seed: 10001, laps: 3, N: 1703, surface: 'asphalt',
        pts: [[460,557],[516,561],[572,561],[628,559],[683,545],[737,530],[792,525],[851,533],[918,530],[949,467],[936,405],[908,352],[874,308],[838,271],[803,230],[771,182],[736,133],[693,90],[639,63],[579,57],[518,65],[459,77],[404,84],[350,82],[296,77],[242,79],[192,99],[152,134],[124,175],[96,218],[62,264],[32,324],[30,394],[59,454],[116,493],[185,500],[247,492],[301,504],[351,532],[404,550]],
        hill: [[0,0],[0.143,-3],[0.266,4],[0.408,4],[0.553,2],[0.712,-6],[0.837,-4]],
        surfaces: [], tunnels: [[0.328,0.388]], bridges: [[0.526,0.593],[0.05,0.109]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cumbres Nevadas", short: "Cumbres", theme: 'alpine', seed: 11001, laps: 3, N: 1513, surface: 'asphalt',
        pts: [[431,560],[486,568],[541,574],[596,577],[654,582],[710,567],[755,530],[792,485],[830,444],[870,410],[906,379],[912,342],[879,306],[842,267],[807,225],[774,179],[742,132],[703,90],[653,61],[595,55],[541,71],[487,79],[430,76],[372,68],[315,70],[263,90],[214,124],[171,159],[146,196],[117,239],[82,284],[54,335],[45,393],[67,447],[120,460],[173,466],[224,482],[273,511],[323,537],[376,551]],
        hill: [[0,0],[0.165,-5],[0.291,-7],[0.405,1],[0.576,-2],[0.69,-3],[0.845,5]],
        surfaces: [], tunnels: [[0.308,0.386]], bridges: [[0.161,0.223],[0.522,0.569]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio de Medianoche", short: "Medianoche", theme: 'neon', seed: 12005, laps: 3, N: 1707, surface: 'asphalt',
        pts: [[296,560],[343,571],[391,571],[438,563],[484,545],[529,526],[577,525],[630,542],[688,548],[744,510],[741,447],[732,398],[725,349],[724,301],[729,253],[717,207],[695,163],[671,120],[642,77],[599,41],[543,43],[496,70],[454,106],[413,137],[370,151],[322,149],[271,140],[222,144],[178,168],[142,202],[105,235],[61,265],[16,295],[-27,352],[-5,442],[72,463],[139,451],[189,459],[218,502],[251,542]],
        hill: [[0,0],[0.182,-4],[0.329,1],[0.49,6],[0.682,-3],[0.813,-5]],
        surfaces: [], tunnels: [[0.359,0.424],[0.507,0.572]], bridges: [[0.25,0.317],[0.672,0.734]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo del Glaciar", short: "Glaciar", theme: 'frost', seed: 13003, laps: 3, N: 1767, surface: 'snow',
        pts: [[366,560],[423,569],[480,573],[538,574],[595,565],[651,552],[707,546],[765,550],[824,544],[880,520],[922,475],[944,419],[937,362],[909,313],[875,267],[839,221],[798,179],[750,146],[695,122],[639,110],[585,117],[527,118],[469,102],[414,80],[358,59],[302,47],[244,45],[186,50],[137,60],[118,110],[96,161],[72,213],[54,269],[52,328],[73,384],[115,426],[163,457],[210,490],[258,522],[311,544]],
        hill: [[0,0],[0.157,-1],[0.279,3],[0.408,-4],[0.596,-3],[0.697,-1],[0.835,-2]],
        surfaces: [], tunnels: [[0.59,0.672],[0.885,0.945]], bridges: [[0.345,0.424],[0.063,0.131]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito del Oasis", short: "Oasis", theme: 'dunes', seed: 14000, laps: 3, N: 1718, surface: 'asphalt',
        pts: [[335,560],[390,565],[445,566],[500,567],[555,575],[614,591],[675,597],[728,563],[769,514],[801,466],[834,426],[879,392],[926,352],[957,298],[952,230],[895,190],[831,179],[779,165],[741,141],[708,110],[663,83],[609,63],[553,53],[497,48],[439,46],[380,51],[326,68],[277,100],[234,141],[193,181],[148,211],[98,233],[47,268],[31,331],[59,388],[107,425],[160,450],[201,479],[235,518],[281,550]],
        hill: [[0,0],[0.144,4],[0.339,5],[0.513,5],[0.675,5],[0.819,3]],
        surfaces: [], tunnels: [[0.515,0.574]], bridges: [[0.619,0.695],[0.054,0.112]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo de la Bahía", short: "Bahía", theme: 'harbor', seed: 15001, laps: 3, N: 1740, surface: 'asphalt',
        pts: [[351,539],[404,551],[458,557],[513,556],[566,541],[619,526],[673,524],[730,531],[787,530],[842,519],[896,493],[940,445],[929,383],[887,344],[843,313],[803,280],[768,239],[734,191],[694,146],[647,116],[591,107],[529,111],[470,116],[419,110],[372,90],[321,69],[264,63],[211,78],[164,109],[122,144],[80,176],[38,214],[10,270],[19,334],[63,378],[119,400],[172,420],[213,454],[252,494],[300,520]],
        hill: [[0,0],[0.142,5],[0.355,6],[0.49,-6],[0.672,6],[0.825,-5]],
        surfaces: [], tunnels: [[0.329,0.408]], bridges: [[0.147,0.197],[0.681,0.737]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio del Crepúsculo", short: "Crepúsculo", theme: 'dusk', seed: 16000, laps: 3, N: 1463, surface: 'asphalt',
        pts: [[313,560],[370,565],[427,569],[484,572],[541,576],[598,568],[655,558],[712,558],[771,558],[828,546],[879,515],[916,469],[914,418],[884,375],[853,327],[820,278],[779,236],[729,207],[672,188],[614,172],[560,153],[513,125],[468,92],[418,60],[363,36],[305,24],[247,27],[189,45],[139,75],[120,116],[116,165],[88,217],[50,269],[17,326],[2,388],[23,458],[89,498],[157,499],[206,520],[257,551]],
        hill: [[0,0],[0.144,1],[0.331,-6],[0.506,-4],[0.659,-4],[0.851,-3]],
        surfaces: [], tunnels: [[0.513,0.589],[0.124,0.193]], bridges: [[0.415,0.465]],
        landmarks: []
    },
    // ===================== ETAPAS (12-23) =====================
    {
        kind: 'stage', name: "Camino de los Cerezos", short: "Cerezos", theme: 'sakura', seed: 9000, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[33,132,32,2.2,6],[17,43,22,-4.8,2],[28,129,28,0,4,'asphalt','T'],
            [15,35,15,6.9,-9],[25,37,22,-5.1,-11],[19,85,22,0,-4],[25,113,28,0,4,'asphalt','T'],
            [15,33,15,6.8,-2],[15,33,15,-6.5,2],[23,49,25,5.1,-8],[15,32,15,-7,2],
            [17,71,22,5.9,0],[26,106,25,0,-4,'asphalt','T'],[22,63,24,-4.8,6],[26,110,20,0,-1,'asphalt','B'],
            [15,31,15,6.7,1],[15,42,15,-6.7,4],[23,47,23,-5.3,11],[15,31,15,6.6,5],
            [19,95,18,0,-8],[21,151,27,0,4,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta de la Sabana", short: "Sabana R.", theme: 'savanna', seed: 10000, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[32,137,34,-3.8,-8],[21,117,25,0,0,'asphalt','B'],[19,123,22,0,4],
            [30,149,28,3.7,-10],[27,196,23,0,0,'asphalt','B'],[33,102,34,-3.3,8],[25,90,23,0,11],
            [15,31,15,6.9,-6],[25,101,25,0,-11],[31,105,30,0,0,'asphalt','T'],[25,84,18,0,4,'asphalt'],
            [31,107,30,-3,6,'asphalt'],[26,112,26,0,-4,'asphalt','B'],[33,104,28,3.6,1],[20,114,23,0,10],
            [25,113,28,0,2,'asphalt','T'],[31,157,29,-3.3,2],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Tierras Bajas", short: "Bajas", theme: 'swamp', seed: 11001, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[18,41,23,5,-7],[15,33,15,-6.2,-4],[15,39,15,6.3,-5],
            [24,134,23,0,3,'asphalt','B'],[16,76,18,4.7,4],[15,33,15,-6.9,-5],[25,70,19,5.9,-6],
            [20,38,21,-5.9,10],[15,42,15,7,4],[15,36,15,-6.6,4],[27,93,32,0,4,'asphalt','T'],
            [36,161,35,-3,8],[15,39,15,6.3,-4],[15,31,15,-6.5,-4],[28,192,24,0,-2,'asphalt','B'],
            [15,31,15,-7,2],[25,60,21,4.1,2],[18,56,19,-4.5,-3],[15,31,15,7,11],
            [29,122,25,0,6,'asphalt','T'],[15,31,15,-6.3,6],[15,31,15,6.7,-3],[15,32,15,6.8,-10],
            [15,33,15,-6.7,-1],[30,162,31,2.9,2],[26,141,28,0,3,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Ámbar", short: "Ámbar", theme: 'autumn', seed: 12000, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[15,34,15,6.6,0],[29,166,29,-2.8,11],[28,128,31,0,4,'asphalt','T'],
            [22,36,23,4.7,-3],[15,39,15,-6.9,3],[21,37,17,6,4],[32,126,33,-3.7,-4],
            [32,122,30,0,1,'asphalt','T'],[17,55,19,4.6,3],[17,42,24,-5.3,-6,'asphalt'],[32,160,33,3.1,-11,'asphalt'],
            [33,147,32,-2.9,-4,'asphalt'],[21,184,23,0,0,'asphalt','B'],[28,132,34,3.6,7,'asphalt'],[24,53,24,-4.2,10],
            [26,165,24,0,1,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Garganta Roja", short: "Garganta", theme: 'canyon', seed: 13000, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[18,79,18,5.4,-12],[24,127,24,0,9],[24,119,28,0,4,'asphalt','B'],
            [15,30,15,-6.7,11],[15,32,15,6.9,-7],[15,40,15,-6.5,8],[35,125,33,3.7,8],
            [15,39,15,-7,0],[15,30,15,6.7,4],[26,113,29,0,2,'asphalt','T'],[15,31,15,6.6,6,'gravel'],
            [15,35,15,-6.6,6,'gravel'],[15,34,15,6.1,-4,'gravel'],[21,38,24,4.3,-2,'gravel'],[20,114,23,0,3,'gravel'],
            [27,183,21,0,-1,'asphalt','B'],[32,109,29,-2.7,6],[21,95,22,0,10],[31,115,32,3,-11],
            [25,136,29,0,4,'asphalt','T'],[18,105,25,0,-10],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso del Cóndor", short: "Cóndor", theme: 'alpine', seed: 14001, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[15,34,15,-6.6,4],[15,34,15,6.3,-1],[20,49,22,4.6,-8],
            [21,91,22,0,-1,'asphalt','B'],[15,42,15,-6,0],[15,34,15,6.7,6],[15,36,15,6.7,-12],
            [23,126,19,0,6],[15,40,15,-6.2,6],[15,45,15,6.1,-2],[25,102,25,0,2,'asphalt','B'],
            [15,40,15,6.9,7],[15,33,15,-6.6,-9],[23,63,20,5.8,3,'snow'],[15,30,15,-6.8,8,'snow'],
            [24,178,24,0,1,'asphalt','B'],[15,30,15,6.6,11,'snow'],[24,72,21,-4.8,-3,'snow'],[15,36,15,6.2,-3,'snow'],
            [15,43,15,-6.7,5],[21,39,25,-4.8,-3],[30,137,30,0,3,'asphalt','T'],[18,45,16,4.6,-7],
            [19,73,16,-5.9,-11],[25,115,26,0,-6,'asphalt','T'],[31,142,35,3.3,2],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Corredor del Puerto", short: "Corredor", theme: 'harbor', seed: 15000, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[25,67,22,5.1,5],[23,155,21,0,-4,'asphalt','B'],[22,125,24,0,11],
            [25,103,25,0,1],[31,142,31,-2.5,7],[27,123,30,0,-3,'asphalt','T'],[15,40,15,6.2,5],
            [15,39,15,-6.2,-2],[15,32,15,-6.1,-2],[15,37,15,6.1,-1],[30,143,30,3,-6],
            [21,170,21,0,-4,'asphalt','B'],[26,126,28,0,3,'asphalt','T'],[29,110,29,-3.5,0],[20,82,19,0,6],
            [23,72,21,0,11],[24,136,31,0,-6,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cumbre Helada", short: "Helada", theme: 'frost', seed: 16001, surface: 'snow',
        sections: [
            [0,60,0,0,0],[15,39,15,-6.5,5],[15,36,15,6.8,-2],[15,36,15,6.1,0],
            [15,39,15,-6.3,3],[19,46,17,-5.6,10],[26,94,22,0,0,'asphalt','B'],[18,63,17,4.8,-5],
            [23,59,21,-4.2,4],[30,159,28,3.5,2],[29,129,31,0,3,'asphalt','T'],[34,160,32,-3.7,9,'asphalt'],
            [15,39,15,6.8,10,'asphalt'],[30,149,32,-2.8,10,'asphalt'],[30,104,27,0,-6,'asphalt','T'],[21,112,26,0,-11,'asphalt'],
            [19,126,18,0,-1],[29,121,30,0,6,'asphalt','T'],[23,44,24,5.6,-1],[16,49,24,-5.7,-12],
            [30,110,35,3.2,0],[15,32,15,-6.9,3],[19,105,25,0,-3],[23,155,20,0,0,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta del Cráter", short: "Cráter", theme: 'volcano', seed: 17003, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[15,36,15,-6.9,-11],[15,38,15,6.9,-4],[15,36,15,-6.6,0],
            [15,35,15,6.4,0],[18,70,19,5.5,11],[15,38,15,-6.1,-4],[15,38,15,6.3,-3],
            [25,105,24,0,-1,'asphalt','B'],[15,29,15,6.8,4],[23,70,22,-4.8,-11],[15,44,15,6.6,0],
            [15,33,15,-6.3,6],[15,37,15,-6.6,-5],[15,38,15,6.5,-5,'asphalt'],[28,99,31,0,5,'asphalt','T'],
            [24,76,20,5.5,5,'asphalt'],[23,73,17,-5.6,8,'asphalt'],[29,124,29,2.5,-6,'asphalt'],[20,59,23,-5.1,-2,'asphalt'],
            [31,139,33,3,10],[29,117,31,0,4,'asphalt','T'],[18,40,17,-4.7,-7],[24,71,22,4.3,10],
            [15,30,15,-6.9,6],[15,31,15,6.7,6],[25,175,22,0,-2,'asphalt','B'],[15,39,15,-6.9,-8],
            [20,65,24,5.4,3],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Travesía del Desierto", short: "Travesía", theme: 'dunes', seed: 18001, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,93,18,0,-2],[31,131,31,2.8,10],[31,118,30,0,5,'asphalt','T'],
            [15,36,15,-6.8,-7],[32,155,29,3,-8],[31,149,31,-3.2,8],[27,145,22,0,2,'asphalt','B'],
            [15,40,15,6.8,3,'asphalt'],[34,152,33,-3.8,8,'asphalt'],[30,120,31,3.8,-8,'asphalt'],[25,111,30,0,5,'asphalt','T'],
            [19,122,24,0,4,'asphalt'],[28,157,30,-2.6,-5],[30,129,36,2.8,5],[24,135,24,0,-4,'asphalt','B'],
            [15,36,15,-6.8,-2],[15,36,15,6.3,4],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Costa de los Lagos", short: "Lagos", theme: 'lake', seed: 19000, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[15,29,15,6.6,-8],[15,35,15,-6,0],[15,30,15,6.7,1],
            [31,111,33,2.8,0],[25,129,27,0,1,'asphalt','T'],[15,29,15,-6.9,-2],[19,60,19,5.8,-4],
            [15,40,15,-6.9,-10],[31,146,30,2.6,-11],[30,147,29,-2.9,10],[26,149,22,0,-1,'asphalt','B'],
            [31,117,34,2.6,10,'asphalt'],[32,100,30,-2.9,-9,'asphalt'],[15,29,15,6.7,4,'asphalt'],[31,163,30,-2.7,-6,'asphalt'],
            [28,140,31,0,0,'asphalt','T'],[32,168,32,3,9],[15,43,15,-6.2,6],[15,39,15,7,-1],
            [15,35,15,6.9,1],[15,31,15,-7,-12],[15,36,15,6.1,-4],[15,39,15,-6.3,1],
            [20,177,23,0,0,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Selva del Jaguar", short: "Jaguar", theme: 'jungle', seed: 20000, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[15,35,15,6.7,-10],[15,35,15,-6.7,6],[19,72,24,4.4,8],
            [15,31,15,-6.4,3],[15,41,15,6.2,-5],[25,62,18,4,12],[22,138,20,0,4,'asphalt','B'],
            [15,33,15,-6.9,-10],[18,65,20,5.2,2],[31,102,30,-3.2,0],[17,64,20,5.2,-4],
            [31,97,25,0,-3,'asphalt','T'],[17,46,21,-6,9],[15,35,15,6.9,7],[21,48,25,-4.7,-9],
            [20,54,20,5.1,-8],[29,123,29,-2.4,-10],[28,105,28,0,2,'asphalt','T'],[15,31,15,6.8,-11],
            [15,40,15,-6.2,4],[15,44,15,6.9,-6],[15,31,15,6.4,6],[15,31,15,-6.1,2],
            [15,31,15,-6.5,1],[15,33,15,7,6],[15,40,15,6.7,0],[15,34,15,-6.8,0],
            [15,35,15,6.5,6],[25,104,22,0,2,'asphalt','B'],[30,152,28,2.8,-9],[0,60,0,0,0]
        ],
        landmarks: []
    }
];
// @@EVENTS_END
const SHORT_NAMES = EVENTS.map(function (ev) { return ev.short; });
const CIRCUIT_IDS = [], STAGE_IDS = [];
EVENTS.forEach(function (ev, i) { (ev.kind === 'circuit' ? CIRCUIT_IDS : STAGE_IDS).push(i); });
const CHAMP_ORDER = [];   // el campeonato alterna circuito y etapa: C1 E1 C2 E2 ...
for (let i = 0; i < CIRCUIT_IDS.length; i++) CHAMP_ORDER.push(CIRCUIT_IDS[i], STAGE_IDS[i]);
const GHOST_DT = 0.1;     // la sombra se graba a 10 muestras por segundo


// ---------------------------------------------------------------------------
// GEOMETRÍA DE CIRCUITOS: spline cerrada -> segmentos equidistantes -> curva por segmento -> cierre exacto.
// Cada segmento gira curva/SEG_LEN radianes (la misma relación que usa el render), y el minimapa integra
// exactamente esa curva: lo que se ve en el mapa es lo que se maneja.
// ---------------------------------------------------------------------------
function catmullClosed(pts, samplesPerSpan) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        for (let s = 0; s < samplesPerSpan; s++) {
            const t = s / samplesPerSpan, t2 = t * t, t3 = t2 * t;
            out.push([
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            ]);
        }
    }
    return out;
}
function resampleClosed(dense, N) {
    const M = dense.length, cum = [0];
    for (let i = 0; i < M; i++) { const a = dense[i], b = dense[(i + 1) % M]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[M], out = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
        const target = total * k / N;
        while (cum[j + 1] < target) j++;
        const a = dense[j], b = dense[(j + 1) % M], f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
}
function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function gaussSmoothCyclic(arr, sigma) {
    const N = arr.length, R = Math.ceil(sigma * 3), ker = [];
    let ks = 0;
    for (let k = -R; k <= R; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); ker.push(v); ks += v; }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -R; k <= R; k++) s += arr[((i + k) % N + N) % N] * ker[k + R]; out[i] = s / ks; }
    return out;
}
// Cierre exacto: giro total = T y punto final = punto inicial, con la mínima corrección suave (K armónicos, los más bruscos penalizados)
function closeSolve(base, T, K) {
    const N = base.length, P = 2 * K + 1, cosT = [], sinT = [];
    for (let k = 1; k <= K; k++) {
        const c = new Float64Array(N), sn = new Float64Array(N);
        for (let i = 0; i < N; i++) { const a = 2 * Math.PI * k * i / N; c[i] = Math.cos(a); sn[i] = Math.sin(a); }
        cosT[k] = c; sinT[k] = sn;
    }
    const W = [];
    for (let j = 0; j < P; j++) W.push(j === 0 ? 1 : 1 + Math.pow(Math.ceil(j / 2), 3));
    const turnAt = function (p, i) {
        let d = base[i] + p[0];
        for (let k = 1; k <= K; k++) d += p[2 * k - 1] * cosT[k][i] + p[2 * k] * sinT[k][i];
        return d;
    };
    const residual = function (p) {
        let h = 0, x = 0, y = 0, H = 0;
        for (let i = 0; i < N; i++) { const d = turnAt(p, i); h += d; H += d; x += Math.cos(h); y += Math.sin(h); }
        return [H - T, x / N, y / N];
    };
    const norm = function (g) { return Math.hypot(g[0], g[1] * 100, g[2] * 100); };
    let p = new Array(P).fill(0), g = residual(p);
    for (let it = 0; it < 80 && norm(g) > 1e-11; it++) {
        const J = [];
        for (let j = 0; j < P; j++) {
            const q = p.slice(); q[j] += 1e-6;
            const gj = residual(q);
            J.push([(gj[0] - g[0]) / 1e-6, (gj[1] - g[1]) / 1e-6, (gj[2] - g[2]) / 1e-6]);
        }
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let j = 0; j < P; j++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += J[j][a] * J[j][b] / W[j];
        const A = [0, 1, 2].map(function (r) { return [M[r][0], M[r][1], M[r][2], -g[r]]; });
        for (let c = 0; c < 3; c++) {
            let piv = c;
            for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
            const tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
            for (let r = 0; r < 3; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= m * A[c][k]; }
        }
        const w = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
        const du = J.map(function (col, j) { return (col[0] * w[0] + col[1] * w[1] + col[2] * w[2]) / W[j]; });
        const n0 = norm(g);
        let step = 1, ok = false;
        for (let tries = 0; tries < 40; tries++) {
            const q = p.map(function (v, j) { return v + step * du[j]; });
            const gq = residual(q);
            if (norm(gq) < n0) { p = q; g = gq; ok = true; break; }
            step *= 0.5;
        }
        if (!ok) break;
    }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = turnAt(p, i);
    return out;
}
// puntos de control -> curva por segmento (unidades de juego) y rumbo inicial
function circuitCurves(ctrl, N) {
    const P = resampleClosed(catmullClosed(ctrl, 60), N);
    const th = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = P[i], b = P[(i + 1) % N]; th[i] = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    const d0 = new Float64Array(N);
    let D = 0;
    for (let i = 0; i < N; i++) { d0[i] = wrapPi(th[i] - th[(i - 1 + N) % N]); D += d0[i]; }
    const T = Math.round(D / (2 * Math.PI)) * 2 * Math.PI;
    const sm = gaussSmoothCyclic(d0, 6);
    let Ds = 0;
    for (let i = 0; i < N; i++) Ds += sm[i];
    const base = new Float64Array(N);
    for (let i = 0; i < N; i++) base[i] = sm[i] + (T - Ds) / N;
    const deltas = closeSolve(base, T, 8);
    const curve = new Float64Array(N);
    for (let i = 0; i < N; i++) curve[i] = deltas[i] * SEG_LEN;
    return { curve: curve, h0: th[0] };
}
// altura periódica (interpolación coseno) entre puntos [fracción, altura]
function heightAt(pts, f) {
    const n = pts.length;
    f = ((f % 1) + 1) % 1;
    let i = 0;
    while (i < n - 1 && pts[i + 1][0] <= f) i++;
    const a = pts[i], b = pts[(i + 1) % n];
    const fa = a[0];
    let fb = b[0], ff = f;
    if (fb <= fa) fb += 1;
    if (ff < fa) ff += 1;
    const t = (ff - fa) / (fb - fa);
    return a[1] + (b[1] - a[1]) * ((1 - Math.cos(t * Math.PI)) / 2);
}

// ---------------------------------------------------------------------------
// CONSTRUCCIÓN DE PISTAS
// ---------------------------------------------------------------------------
const TRACK_CACHE = [];
function getTrack(i) {
    if (!TRACK_CACHE[i]) TRACK_CACHE[i] = buildTrack(i);
    return TRACK_CACHE[i];
}

function pickWeighted(list, rng) {
    let total = 0;
    for (const e of list) total += e.w;
    let r = rng() * total;
    for (const e of list) { r -= e.w; if (r <= 0) return e.k; }
    return list[0].k;
}

function gradeFor(peak) {
    if (peak >= 7) return 1;
    if (peak >= 5.5) return 2;
    if (peak >= 4.2) return 3;
    if (peak >= 3) return 4;
    if (peak >= 2.2) return 5;
    return 6;
}
const GRADE_WORDS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];


function detectNotes(segs) {
    const notes = [];
    const N = segs.length;
    let i = 0;
    while (i < N) {
        const c = segs[i].curve;
        if (Math.abs(c) >= 1.2) {
            const sign = Math.sign(c);
            let j = i, peak = 0;
            while (j < N && Math.sign(segs[j].curve) === sign && Math.abs(segs[j].curve) >= 0.5) {
                peak = Math.max(peak, Math.abs(segs[j].curve));
                j++;
            }
            if (peak >= 2) {
                const grade = gradeFor(peak);
                const len = j - i;
                const note = { seg: i, end: j, dir: sign < 0 ? 'L' : 'R', grade: grade, len: len, long: len >= 70, hairpin: grade === 1 };
                note.voice = (note.dir === 'L' ? 'izquierda ' : 'derecha ') + GRADE_WORDS[grade] +
                    (note.hairpin ? ', horquilla' : '') + (note.long ? ', larga' : '');
                notes.push(note);
            }
            i = j;
        } else {
            i++;
        }
    }
    return notes;
}


function buildTrack(idx) {
    const def = EVENTS[idx];
    const theme = THEMES[def.theme];
    const rng = mulberry32(def.seed);
    const circ = def.kind === 'circuit';
    const segs = [];

    function mkPt(z, y) { return { world: { x: 0, y: y, z: z }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } }; }
    function lastY() { return segs.length ? segs[segs.length - 1].p2.world.y : 0; }
    function pushSeg(curve, y1, y2, surface) {
        const n = segs.length;
        segs.push({
            index: n, p1: mkPt(n * SEG_LEN, y1), p2: mkPt((n + 1) * SEG_LEN, y2),
            curve: curve, surface: surface, alt: Math.floor(n / RUMBLE_LEN) % 2, colors: null, objs: [], gate: null,
            tunnel: false, bridge: false, tunnelStart: false, lamp: false, arch: false
        });
    }
    function addRoad(enter, hold, leave, curve, hill, surface, feat) {
        const startY = lastY(), endY = startY + (hill || 0) * SEG_LEN, total = enter + hold + leave;
        const first = segs.length;
        let n;
        for (n = 0; n < enter; n++) pushSeg(easeIn(0, curve, n / enter), lastY(), easeInOut(startY, endY, n / total), surface);
        for (n = 0; n < hold; n++) pushSeg(curve, lastY(), easeInOut(startY, endY, (enter + n) / total), surface);
        for (n = 0; n < leave; n++) pushSeg(easeInOut(curve, 0, n / leave), lastY(), easeInOut(startY, endY, (enter + hold + n) / total), surface);
        if (feat) for (let i = first; i < segs.length; i++) segs[i][feat === 'T' ? 'tunnel' : 'bridge'] = true;
    }

    let finishSeg, h0;
    if (circ) {
        const cc = circuitCurves(def.pts, def.N);
        h0 = cc.h0;
        for (let i = 0; i < def.N; i++) {
            const f = i / def.N;
            let surf = def.surface;
            for (const r of def.surfaces) if (f >= r[0] && f < r[1]) surf = r[2];
            pushSeg(cc.curve[i], heightAt(def.hill, f) * SEG_LEN, heightAt(def.hill, (i + 1) / def.N) * SEG_LEN, surf);
        }
        const mark = function (list, key) {
            for (const r of list) { const a = Math.round(r[0] * def.N), b = Math.round(r[1] * def.N); for (let i = a; i < b; i++) segs[i][key] = true; }
        };
        mark(def.tunnels, 'tunnel');
        mark(def.bridges, 'bridge');
        finishSeg = def.N;
    } else {
        for (const s of def.sections) addRoad(s[0], s[1], s[2], s[3], s[4], s[5] || def.surface, s[6]);
        addRoad(0, RUNOUT_SEGS, 0, 0, 0, def.surface);
        finishSeg = segs.length - RUNOUT_SEGS;
        h0 = -Math.PI / 2;
    }
    const N = segs.length;

    // Bordes de las estructuras: boca del túnel, luces del techo, arcos del puente
    let bridgeRun = 0;
    for (let i = 0; i < N; i++) {
        const s = segs[i], prev = segs[(i - 1 + N) % N];
        if (s.tunnel && !prev.tunnel) s.tunnelStart = true;
        if (s.tunnel && i % 8 < 2) s.lamp = true;
        if (s.bridge) { bridgeRun = (prev.bridge ? bridgeRun : 0) + 1; if (bridgeRun % 26 === 13) s.arch = true; } else bridgeRun = 0;
    }

    // Colores por segmento (el tema pone el paisaje; túnel y puente cambian el suelo y los bordes)
    for (let i = 0; i < N; i++) {
        const s = segs[i], alt = s.alt, base = SURFACES[s.surface];
        const oc = theme.surfColors && theme.surfColors[s.surface];
        let road = (oc ? oc.road : base.road)[alt], rumble = (oc ? oc.rumble : base.rumble)[alt], grass = theme.grass[alt];
        if (s.bridge) { grass = theme.water[alt]; rumble = ['#cfcdc4', '#b9b7ae'][alt]; }
        if (s.tunnel) { grass = '#0a0a0e'; road = mixHex(road, '#000000', 0.5); rumble = ['#4a4a55', '#3d3d47'][alt]; }
        s.colors = { grass: grass, road: road, rumble: rumble };
    }

    // Puertas: salida/checkpoints/meta en etapas; línea de meta en circuitos
    const cps = [];
    if (circ) {
        segs[0].gate = 'finish';
    } else {
        segs[14].gate = 'start';
        [0.27, 0.54, 0.79].forEach(function (f) {
            let c = Math.round(finishSeg * f);
            while (segs[c].tunnel || segs[c].bridge || segs[c - 5].tunnel || segs[c - 5].bridge || segs[c + 5].tunnel || segs[c + 5].bridge) c++;
            cps.push(c);
            segs[c].gate = 'cp';
        });
        segs[finishSeg].gate = 'finish';
    }

    // Decorado (determinístico por semilla); sin objetos sobre túneles, puentes ni sus accesos
    const nearStruct = function (i) {
        for (let d = -4; d <= 4; d++) { const q = segs[(i + d + N) % N]; if (q.tunnel || q.bridge) return true; }
        return false;
    };
    for (let i = circ ? 6 : 24; i < finishSeg; i++) {
        const s = segs[i];
        if (nearStruct(i)) continue;
        if (i % 3 === 0) {
            for (const side of [-1, 1]) {
                if (rng() < 0.55) {
                    const kind = pickWeighted(theme.deco, rng);
                    if (kind === 'lamp') { s.objs.push({ kind: kind, offset: side * 1.3, size: 1, hitW: 0.05 }); continue; }
                    const off = side * (kind === 'bldg' ? 2.8 + rng() * 3 : 1.55 + rng() * 3.2);
                    let hit = 0;
                    if ((kind === 'pine' || kind === 'snowpine' || kind === 'broadleaf') && Math.abs(off) < 2.1) hit = 0.12;
                    if ((kind === 'rock' || kind === 'cactus' || kind === 'mesa') && Math.abs(off) < 2.1) hit = 0.16;
                    s.objs.push({ kind: kind, offset: off, size: 0.8 + rng() * 0.6, hitW: hit });
                }
            }
        }
        if (rng() < 0.012 && i < finishSeg - 10) {
            const side = rng() < 0.5 ? -1 : 1;
            s.objs.push({ kind: (theme === THEMES.canyon || theme === THEMES.dunes) ? 'cactus' : 'rock', offset: side * (1.08 + rng() * 0.25), size: 0.7 + rng() * 0.4, hitW: 0.16 });
        }
        if (Math.abs(s.curve) >= 3.5 && i % 4 === 0) {
            s.objs.push({ kind: 'chevron', offset: -Math.sign(s.curve) * 1.3, dir: Math.sign(s.curve), size: 1, hitW: 0.07 });
        }
    }
    for (const lm of (def.landmarks || [])) {
        const li = Math.floor(lm.frac * finishSeg);
        if (!nearStruct(li)) segs[li].objs.push({ kind: lm.kind, offset: lm.offset, size: 1, hitW: 0 });
    }

    // Notas del copiloto: curvas + avisos de túnel y puente
    const notes = detectNotes(circ ? segs : segs.slice(0, finishSeg));
    notes.forEach(function (n) { n.kind = 'curve'; });
    const addFeatureNotes = function (key, kind, voice) {
        let i = 0;
        while (i < finishSeg) {
            if (segs[i][key]) {
                let j = i;
                while (j < finishSeg && segs[j][key]) j++;
                notes.push({ seg: i, end: j, kind: kind, grade: 0, dir: null, voice: voice, len: j - i });
                i = j;
            } else i++;
        }
    };
    addFeatureNotes('tunnel', 'tunnel', 'túnel');
    addFeatureNotes('bridge', 'bridge', 'puente');
    notes.sort(function (a, b) { return a.seg - b.seg; });

    // Minimapa: geometría real (cada segmento gira curva/SEG_LEN)
    let hh = h0, mx = 0, my = 0;
    const raw = [], feat = [];
    for (let i = 0; i < finishSeg; i++) {
        hh += segs[i].curve / SEG_LEN;
        mx += Math.cos(hh); my += Math.sin(hh);
        if (i % 6 === 0) { raw.push({ x: mx, y: my }); feat.push(segs[i].tunnel ? 1 : (segs[i].bridge ? 2 : 0)); }
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const mini = {
        pts: raw.map(function (p) { return { x: (p.x - minX) / span, y: (p.y - minY) / span }; }),
        w: (maxX - minX) / span, h: (maxY - minY) / span, feat: feat, closed: circ
    };

    const surfSeen = [];
    for (let i = 0; i < finishSeg; i++) if (surfSeen.indexOf(segs[i].surface) < 0) surfSeen.push(segs[i].surface);
    let nT = 0, nB = 0;
    notes.forEach(function (n) { if (n.kind === 'tunnel') nT++; if (n.kind === 'bridge') nB++; });

    return {
        idx: idx, def: def, mode: def.kind, theme: theme, segs: segs, N: N, TL: N * SEG_LEN,
        laps: circ ? def.laps : 1, finishSeg: finishSeg, cps: cps, notes: notes, mini: mini,
        km: finishSeg * SEG_LEN * M_PER_UNIT / 1000,
        surfaces: surfSeen.map(function (k) { return SURFACES[k].name; }), nT: nT, nB: nB
    };
}

// Velocidad "ideal" por segmento (km/h): tope de la superficie, límite de agarre en cada curva y límites de
// frenada/aceleración entre segmentos (en circuitos se recorre dos veces para cerrar el lazo).
function idealSpeeds(stg, vehIdx) {
    if (!stg.vcache) stg.vcache = [];
    if (stg.vcache[vehIdx]) return stg.vcache[vehIdx];
    const veh = VEHICLES[vehIdx], circ = stg.mode === 'circuit', n = circ ? stg.N : stg.finishSeg, v = new Array(n);
    for (let i = 0; i < n; i++) {
        const seg = stg.segs[i], surf = SURFACES[seg.surface], vs = veh.surf[seg.surface];
        const effGrip = surf.grip * vs, topSeg = veh.top * surf.top, c = Math.abs(seg.curve);
        let vc = topSeg;
        if (c > 0.3) vc = Math.min(topSeg, veh.top * 0.85 * veh.steer * effGrip / (c * 0.42 * surf.push / vs));
        v[i] = Math.max(35, vc);
    }
    const nextOf = function (i) { return circ ? (i + 1) % n : i + 1; };
    for (let p = 0; p < (circ ? 2 : 1); p++) {
        for (let i = circ ? n - 1 : n - 2; i >= 0; i--) {
            const surf = SURFACES[stg.segs[i].surface];
            v[i] = Math.min(v[i], v[nextOf(i)] + 3.2 * (veh.brake / 135) * surf.brake);
        }
    }
    let prev = circ ? v[n - 1] : 20;
    for (let p = 0; p < (circ ? 2 : 1); p++) {
        for (let i = 0; i < n; i++) {
            const surf = SURFACES[stg.segs[i].surface];
            v[i] = Math.min(v[i], prev + 1.3 * (veh.a0 / 42) * surf.accel);
            prev = v[i];
        }
    }
    stg.vcache[vehIdx] = v;
    return v;
}

// Tiempo para recorrer los segmentos [a,b) a "ratio" de la velocidad ideal
function refTime(stg, vehIdx, ratio, a, b) {
    const v = idealSpeeds(stg, vehIdx);
    let t = 0;
    for (let i = a; i < b; i++) t += SEG_LEN / (v[i] * KMH_WORLD * ratio);
    return t;
}


// ---------------------------------------------------------------------------
// ESTADO DEL JUEGO
// ---------------------------------------------------------------------------
let gameState = 'START';   // START, COUNTDOWN, RUNNING, PAUSED, FINISHING, ENDED
let selMode = 0, selEventVal = 0, selOrder = [], selGroup = 'all', selVeh = 0, selDiff = 1;
let ghostRec = null, ghostCar = null, runGhost = { p: [0], x: [0] }, ghostAcc = 0;   // contrarreloj: récord guardado, auto de sombra y grabación de la vuelta en curso
let voiceMode = 0;         // 0 voz + texto, 1 solo texto, 2 apagado
let musicOn = true;
let comp = null;           // { order:[...], k:0, results:[], playerPoints, rivals }
let stage = null, stageIdx = 0, curTheme = THEMES.harbor, skyGrad = null, stars = [];

let position = 0, playerX = 0, vx = 0, speed = 0, steerInput = 0, slip = 0;
let stageTime = 0, timeLeft = 0, damage = 0, stageStartDamage = 0;
let crashCooldown = 0, crashFlash = 0;
let nextCp = 0, cpBonus = [], lapAllow = 0, lapNo = 0, lapTimes = [], lapStartTime = 0;
let noteAnnounced = {}, lastFeature = '', lastIdx = -1;
let popup = { t: 0, text: '', sub: '' };
let countdown = 0, lastCountNum = 4, finishTimer = 0, stageResult = null;
let rpm = 1200, gear = 1, bgX = 0;
let particles = [], flakes = [];
const keys = { left: false, right: false, up: false, down: false };
const entries = [];         // segmentos visibles del cuadro actual
let rivals = [];            // rivales de IA de la prueba en curso
let raceClock = 0;          // reloj de los rivales (arranca con la cuenta regresiva)
let raceT0 = 0;             // valor de raceClock en el instante de la largada (¡YA!)

const RECORDS_KEY = 'retroRally5Records_v1';
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch (e) { return {}; } }
function saveRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); return true; } catch (e) { return false; } }

// Distancia dentro de la vuelta (circuitos) o absoluta (etapas)
function wrapZ(z) { const TL = stage.TL; return ((z % TL) + TL) % TL; }
function segIndexAt(z) {
    const N = stage.N;
    return stage.mode === 'circuit' ? Math.floor(wrapZ(z) / SEG_LEN) % N : clamp(Math.floor(z / SEG_LEN), 0, N - 1);
}
function raceGoal() { return stage.mode === 'circuit' ? stage.laps * stage.TL : stage.finishSeg * SEG_LEN; }

function setTheme(stg) {
    curTheme = stg.theme;
    skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    skyGrad.addColorStop(0, curTheme.skyTop);
    skyGrad.addColorStop(0.6, curTheme.skyMid);
    skyGrad.addColorStop(1, curTheme.skyBottom);
    const r = mulberry32(7);
    stars = [];
    for (let i = 0; i < 70; i++) stars.push({ x: r() * WIDTH, y: r() * HEIGHT * 0.40, s: r() * 1.6 + 0.4, tw: r() * 6 });
    flakes = [];
    for (let i = 0; i < 130; i++) flakes.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 1 + Math.random() * 2, s: 40 + Math.random() * 60 });
}

// ---------------------------------------------------------------------------
// AUDIO (todo procedural, sin archivos)
// ---------------------------------------------------------------------------
let _ac = null;
function getAC() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    return _ac;
}
function makeNoiseBuffer(a, secs) {
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * secs), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}


// Motor: dientes de sierra + cuadrada por un pasa-bajos, ruido de ruta según la superficie y eco de túnel
let eng = null;
function startEngine() {
    try {
        stopEngine();
        const a = getAC();
        const veh = VEHICLES[selVeh];
        const master = a.createGain(); master.gain.value = 0.55; master.connect(a.destination);
        // Eco del túnel: retardo con realimentación; solo se oye (ganancia > 0) mientras se está dentro de un túnel
        const wet = a.createGain(); wet.gain.value = 0;
        const dly = a.createDelay(0.6); dly.delayTime.value = 0.085;
        const fb = a.createGain(); fb.gain.value = 0.45;
        const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        master.connect(wet); wet.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(a.destination);
        const filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.connect(master);
        const o1 = a.createOscillator(); o1.type = 'sawtooth';
        const o2 = a.createOscillator(); o2.type = 'square';
        const g1 = a.createGain(); g1.gain.value = 0.12;
        const g2 = a.createGain(); g2.gain.value = 0.05;
        o1.connect(g1); o2.connect(g2); g1.connect(filt); g2.connect(filt);
        const nb = makeNoiseBuffer(a, 1.5);
        const n1 = a.createBufferSource(); n1.buffer = nb; n1.loop = true;
        const nf = a.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
        const ng = a.createGain(); ng.gain.value = 0;
        n1.connect(nf); nf.connect(ng); ng.connect(master);
        const t = a.currentTime;
        o1.start(t); o2.start(t); n1.start(t);
        eng = { o1: o1, o2: o2, g1: g1, g2: g2, filt: filt, n1: n1, nf: nf, ng: ng, master: master, wet: wet, dly: dly, fb: fb, lp: lp, veh: veh };
    } catch (e) { eng = null; }
}
function stopEngine() {
    if (!eng) return;
    try {
        eng.o1.stop(); eng.o2.stop(); eng.n1.stop();
        eng.master.disconnect(); eng.wet.disconnect(); eng.dly.disconnect(); eng.fb.disconnect(); eng.lp.disconnect();
    } catch (e) {}
    eng = null;
}
function updateEngineAudio() {
    if (!eng) return;
    try {
        const a = getAC(), t = a.currentTime, veh = eng.veh;
        const f = rpm / 60 * veh.pulses;
        eng.o1.frequency.setTargetAtTime(f, t, 0.04);
        eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        eng.filt.frequency.setTargetAtTime(350 + rpm * 0.16 * veh.tone, t, 0.05);
        eng.g1.gain.setTargetAtTime(0.08 + 0.10 * (rpm / veh.rpmMax), t, 0.05);
        const seg = stage ? stage.segs[segIndexAt(position + PLAYER_Z)] : null;
        const surf = seg ? SURFACES[seg.surface] : SURFACES.asphalt;
        const sr = clamp(speed / veh.top, 0, 1);
        const tun = !!(seg && seg.tunnel);
        eng.nf.frequency.setTargetAtTime(surf.noiseF, t, 0.1);
        eng.ng.gain.setTargetAtTime(surf.noiseG * sr * (Math.abs(playerX) > 1.08 && !tun ? 1.8 : 1) * (tun ? 1.4 : 1), t, 0.08);
        eng.wet.gain.setTargetAtTime(tun ? 0.55 : 0, t, 0.12);
        eng.master.gain.setTargetAtTime(tun ? 0.7 : 0.55, t, 0.12);
    } catch (e) {}
}
// Golpe grave al cruzar las juntas de dilatación de un puente
function playThump() {
    try {
        const a = getAC(), t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.07);
        g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.1);
    } catch (e) {}
}

function beep(freq, len) {
    try {
        const a = getAC(), t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + len + 0.02);
    } catch (e) {}
}
function playCrashSound() {
    try {
        const a = getAC(), t = a.currentTime;
        const src = a.createBufferSource(); src.buffer = makeNoiseBuffer(a, 0.28);
        const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
        f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.24);
        const g = a.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.28);
    } catch (e) {}
}
function playCheckpointSound() { beep(660, 0.12); setTimeout(function () { beep(990, 0.22); }, 120); }
function playFinishSound() { beep(523, 0.15); setTimeout(function () { beep(659, 0.15); }, 150); setTimeout(function () { beep(784, 0.35); }, 300); }

// Música chiptune (Dm - Bb - F - C)
const MUSIC_BPM = 146;
const MUSIC_CHORDS = [
    { bass: 146.83, arp: [293.66, 349.23, 440.00, 349.23] },
    { bass: 116.54, arp: [233.08, 293.66, 349.23, 293.66] },
    { bass: 174.61, arp: [349.23, 440.00, 523.25, 440.00] },
    { bass: 130.81, arp: [329.63, 392.00, 523.25, 392.00] }
];
let _mTimer = null, _mGain = null, _mNext = 0, _mStep = 0, _mNoise = null;
function mTone(type, freq, t, len, vol) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + len + 0.02);
}
function mKick(t) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + 0.18);
}
function mSnare(t) {
    const a = getAC(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = _mNoise; f.type = 'highpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(_mGain); s.start(t); s.stop(t + 0.13);
}
function playMusicStep(step, t, dur) {
    const chord = MUSIC_CHORDS[Math.floor(step / 16) % MUSIC_CHORDS.length];
    if (step % 2 === 0) mTone('triangle', chord.bass, t, dur * 1.9, 0.9);
    mTone('square', chord.arp[step % 4], t, dur * 0.8, 0.20);
    const pos = step % 16;
    if (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 12) mTone('square', chord.arp[(pos >> 2) % 4] * 2, t, dur * 1.4, 0.16);
    if (step % 4 === 0) mKick(t);
    if (step % 8 === 4) mSnare(t);
}
function scheduleMusic() {
    try {
        const a = getAC(), stepDur = 60 / MUSIC_BPM / 4;
        while (_mNext < a.currentTime + 0.15) {
            playMusicStep(_mStep, _mNext, stepDur);
            _mNext += stepDur;
            _mStep = (_mStep + 1) % (MUSIC_CHORDS.length * 16);
        }
    } catch (e) {}
}
function startMusic() {
    try {
        if (!musicOn || _mTimer) return;
        const a = getAC();
        if (a.state === 'suspended') a.resume();
        _mGain = a.createGain(); _mGain.gain.value = 0.10; _mGain.connect(a.destination);
        _mNoise = makeNoiseBuffer(a, 0.2);
        _mNext = a.currentTime + 0.05; _mStep = 0;
        _mTimer = setInterval(scheduleMusic, 25);
    } catch (e) {}
}
function stopMusic() {
    if (_mTimer) { clearInterval(_mTimer); _mTimer = null; }
    try { if (_mGain) _mGain.disconnect(); } catch (e) {}
    _mGain = null;
}

// Copiloto por voz
function speak(text) {
    if (voiceMode !== 0) return;
    try {
        if (!('speechSynthesis' in window)) return;
        if (window.speechSynthesis.pending) window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 1.25; u.volume = 1;
        window.speechSynthesis.speak(u);
    } catch (e) {}
}
function cancelSpeech() { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {} }
function stopAllAudio() { stopEngine(); stopMusic(); cancelSpeech(); }


// ---------------------------------------------------------------------------
// ENTRADA
// ---------------------------------------------------------------------------
function initInput() {
    const NAV = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];
    window.addEventListener('keydown', function (e) {
        if (NAV.indexOf(e.key) >= 0) e.preventDefault();
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = true;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = true;
        if (e.key === 'ArrowDown' || k === 's') keys.down = true;
        if (!e.repeat && (k === 'p' || e.key === 'Escape')) togglePause();
        if (!e.repeat && k === 'm') toggleMusic();
        if (!e.repeat && k === 'c') cycleVoice();
    });
    window.addEventListener('keyup', function (e) {
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = false;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = false;
        if (e.key === 'ArrowDown' || k === 's') keys.down = false;
    });
    window.pressTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = true; };
    window.releaseTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = false; };
    window.addEventListener('blur', function () { if (gameState === 'RUNNING') togglePause(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && gameState === 'RUNNING') togglePause(); });

    document.getElementById('btnStartRace').onclick = startCompetition;
}

function togglePause() {
    if (gameState === 'RUNNING') {
        gameState = 'PAUSED';
        stopAllAudio();
    } else if (gameState === 'PAUSED') {
        gameState = 'RUNNING';
        startEngine(); startMusic();
    }
}
window.togglePause = togglePause;

function toggleMusic() {
    musicOn = !musicOn;
    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN') { if (musicOn) startMusic(); else stopMusic(); }
}
function cycleVoice() {
    voiceMode = (voiceMode + 1) % 3;
    popup = { t: 1.6, text: 'COPILOTO', sub: ['VOZ + TEXTO', 'SOLO TEXTO', 'APAGADO'][voiceMode] };
    if (voiceMode !== 0) cancelSpeech();
}


// ---------------------------------------------------------------------------
// COPILOTO: curvas, túneles y puentes (con vuelta completa en circuitos)
// ---------------------------------------------------------------------------
// Unidades de mundo hasta el inicio de la nota (0 si ya estás dentro). Infinity si queda después de la meta.
function noteDistance(n) {
    const circ = stage.mode === 'circuit';
    const pzT = position + PLAYER_Z;
    const pz = circ ? wrapZ(pzT) : pzT;
    const start = n.seg * SEG_LEN, end = n.end * SEG_LEN;
    if (pz >= start && pz < end) return 0;
    let d = start - pz;
    if (d < 0) { if (circ) d += stage.TL; else return Infinity; }
    if (d > raceGoal() - pzT) return Infinity;   // quedaría después de la meta
    return d;
}
function upcomingNotes(maxN, maxM) {
    const out = [];
    for (let i = 0; i < stage.notes.length; i++) {
        const m = noteDistance(stage.notes[i]) * M_PER_UNIT;
        if (m <= maxM) out.push({ n: stage.notes[i], i: i, m: m });
    }
    out.sort(function (a, b) { return a.m - b.m; });
    return out.slice(0, maxN);
}
function updateCopilot() {
    if (voiceMode !== 0) return;
    const lead = 55 + (speed / 3.6) * 2.8;   // metros de anticipación
    const key = stage.mode === 'circuit' ? Math.floor((position + PLAYER_Z) / stage.TL) : 0;
    for (let i = 0; i < stage.notes.length; i++) {
        const n = stage.notes[i];
        if (n.kind === 'curve' && n.grade > 4) continue;       // por voz solo las curvas importantes; el texto muestra todas
        if (noteAnnounced[i] === key) continue;
        const m = noteDistance(n) * M_PER_UNIT;
        if (m <= lead) {
            noteAnnounced[i] = key;
            if (m > 0) { speak(n.voice); return; }
        }
    }
}

// ---------------------------------------------------------------------------
// FLUJO: menú, campeonato, pruebas, resultados
// ---------------------------------------------------------------------------
const DAMAGE_CARRY = 0.3;   // fracción del daño que sigue puesta entre pruebas (el equipo repara el 70%)
function readMenu() {
    const g = function (id, d) { const e = document.getElementById(id); const v = e ? parseInt(e.value, 10) : d; return isNaN(v) ? d : v; };
    selMode = g('selectMode', 0);
    selEventVal = g('selectEvent', 0);
    selVeh = g('selectVehicle', 0);
    selDiff = g('selectDifficulty', 1);
    voiceMode = g('selectVoice', 0);
    musicOn = g('selectMusic', 1) === 1;
    if (selMode === 0) { selOrder = CHAMP_ORDER.slice(); selGroup = 'all'; }
    else if (selMode === 1) { selGroup = selEventVal === 0 ? 'stg' : 'cir'; selOrder = (selEventVal === 0 ? STAGE_IDS : CIRCUIT_IDS).slice(); }
    else { selOrder = [clamp(selEventVal, 0, EVENTS.length - 1)]; selGroup = 'one'; }
}

// Carga las opciones del selector de prueba según el modo (campeonato: todas; rally: 6 etapas o 6 circuitos; individual y contrarreloj: una a elección)
let lastMenuMode = -1;
function populateEvents() {
    const sel = document.getElementById('selectEvent'), ms = document.getElementById('selectMode');
    if (!sel || !ms) return;
    const mode = parseInt(ms.value, 10) || 0;
    const prev = sel.value;
    let html = '';
    if (mode === 0) html = '<option value="0">Las ' + CHAMP_ORDER.length + ' pruebas (' + CIRCUIT_IDS.length + ' circuitos + ' + STAGE_IDS.length + ' etapas)</option>';
    else if (mode === 1) html = '<option value="0">Las ' + STAGE_IDS.length + ' etapas</option><option value="1">Los ' + CIRCUIT_IDS.length + ' circuitos</option>';
    else {
        const opt = function (i) { return '<option value="' + i + '">' + EVENTS[i].name + '</option>'; };
        html = '<optgroup label="Circuitos">' + CIRCUIT_IDS.map(opt).join('') + '</optgroup><optgroup label="Etapas">' + STAGE_IDS.map(opt).join('') + '</optgroup>';
    }
    sel.innerHTML = html;
    sel.disabled = (mode === 0);
    if (mode >= 2 && lastMenuMode >= 2 && prev !== '') sel.value = prev;   // al pasar de carrera a contrarreloj conserva la prueba
    lastMenuMode = mode;
    const ds = document.getElementById('selectDifficulty');
    if (ds) ds.disabled = (mode === 3);   // en la contrarreloj no hay rivales
}
function onModeChange() { populateEvents(); updateMenu(); }
window.onModeChange = onModeChange;

function updateMenu() {
    readMenu();
    const contSnap = refreshCont();
    if (contSnap) readMenu();
    const first = contSnap ? selOrder[contSnap.k] : selOrder[0];
    const stg = getTrack(first);
    setBackdrop(first);

    const pc = document.getElementById('menuMapCanvas');
    if (pc) {
        const pctx = pc.getContext('2d');
        pctx.clearRect(0, 0, pc.width, pc.height);
        drawMini(pctx, 0, 0, 130, stg, -1, null);
    }
    const nm = document.getElementById('previewName'), inf = document.getElementById('previewInfo');
    const circuit = stg.mode === 'circuit';
    if (nm && inf) {
        if (selMode <= 1) {
            nm.textContent = selMode === 0 ? 'CAMPEONATO · ' + CHAMP_ORDER.length + ' PRUEBAS' : (selGroup === 'stg' ? 'RALLY · ' + STAGE_IDS.length + ' ETAPAS' : 'RALLY · ' + CIRCUIT_IDS.length + ' CIRCUITOS');
            const nC = selOrder.filter(function (i) { return EVENTS[i].kind === 'circuit'; }).length, nS = selOrder.length - nC;
            inf.textContent = (nC ? nC + ' circuitos' : '') + (nC && nS ? ' + ' : '') + (nS ? nS + ' etapas' : '') + ' · de ' + SHORT_NAMES[selOrder[0]] + ' a ' + SHORT_NAMES[selOrder[selOrder.length - 1]] + ' · con túneles y puentes';
        } else {
            nm.textContent = (selMode === 3 ? 'CRONO · ' : '') + (circuit ? 'CIRCUITO · ' : 'ETAPA · ') + stg.def.name.toUpperCase();
            inf.textContent = (circuit ? stg.laps + ' vueltas de ' + stg.km.toFixed(1) + ' km' : 'A→B · ' + stg.km.toFixed(1) + ' km') +
                ' · ' + stg.nT + ' túneles · ' + stg.nB + ' puentes · ' + stg.surfaces.join(' + ');
        }
    }
    const inf2 = document.getElementById('previewInfo');
    if (contSnap && inf2) inf2.textContent = 'PARTIDA GUARDADA · ' + contSnap.k + ' de ' + selOrder.length + ' pruebas hechas · sigue ' + SHORT_NAMES[first] + ' · ' + contSnap.playerPoints + ' pts';
    const sb = document.getElementById('btnStartRace');
    if (sb) sb.innerText = contSnap ? 'CONTINUAR (PRUEBA ' + (contSnap.k + 1) + '/' + selOrder.length + ')' : 'A LA PARTIDA';
    const note = document.getElementById('menuNote');
    if (note) { note.textContent = menuNote; if (menuNote) note.classList.remove('hidden'); else note.classList.add('hidden'); }
    const rec = document.getElementById('menuRecords');
    if (rec) {
        const r = loadRecords();
        if (selMode <= 1) {
            rec.textContent = 'RÉCORD ' + (selMode === 0 ? 'CAMPEONATO' : (selGroup === 'stg' ? 'RALLY ETAPAS' : 'RALLY CIRCUITOS')) + ' ' + formatTime(r['c' + selGroup + '_' + selVeh + '_' + selDiff]);
        } else if (selMode === 2) {
            const e = r['e' + first + '_' + selVeh + '_' + selDiff] || {};
            rec.textContent = circuit
                ? 'RÉCORD CARRERA ' + formatTime(e.race) + '  ·  VUELTA ' + formatTime(e.lap)
                : 'RÉCORD ETAPA ' + formatTime(e.race);
        } else {
            const e = r['t' + first + '_' + selVeh] || {};
            rec.textContent = e.time == null ? 'SIN SOMBRA TODAVÍA: la primera carrera la crea'
                : 'SOMBRA ' + formatTime(e.time) + (circuit ? '  ·  MEJOR VUELTA ' + formatTime(e.lap) : '');
        }
    }
}
window.updateMenu = updateMenu;

function setBackdrop(i) {
    rivals = []; ghostCar = null; ghostRec = null;
    stage = getTrack(i); stageIdx = i; setTheme(stage);
    position = 0; playerX = 0; speed = 0; bgX = 0;
}


// ---------------- partida guardada del campeonato / rally ----------------
// Una partida por grupo: 'all' (campeonato), 'stg' (rally de etapas), 'cir' (rally de circuitos).
const SAVE_KEY = RECORDS_KEY.replace('Records', 'Save');
function loadSaves() { try { const o = JSON.parse(localStorage.getItem(SAVE_KEY)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function writeSaves(o) {
    try {
        if (Object.keys(o).length) localStorage.setItem(SAVE_KEY, JSON.stringify(o)); else localStorage.removeItem(SAVE_KEY);
        return true;
    } catch (e) { return false; }
}
function groupOrder(group) { return group === 'all' ? CHAMP_ORDER : group === 'stg' ? STAGE_IDS : group === 'cir' ? CIRCUIT_IDS : null; }
// Devuelve la partida guardada del grupo solo si es coherente con este juego; si no, null
function getSave(group) {
    const s = loadSaves()[group];
    const ord = groupOrder(group);
    if (!s || !ord || s.group !== group || !Array.isArray(s.order) || s.order.length !== ord.length) return null;
    for (let i = 0; i < ord.length; i++) if (s.order[i] !== ord[i]) return null;
    if (!(s.k >= 1 && s.k < ord.length) || s.results.length !== s.k) return null;
    if (!(s.veh >= 0 && s.veh <= 2 && s.diff >= 0 && s.diff <= 2)) return null;
    if (!Array.isArray(s.rivals) || s.rivals.length !== RIVAL_NAMES.length) return null;
    for (const r of s.rivals) if (!(r && r.id >= 0 && r.veh >= 0 && r.veh <= 2 && isFinite(r.ratio) && isFinite(r.points) && isFinite(r.totalTime))) return null;
    for (const x of s.results) if (!(x && isFinite(x.time) && isFinite(x.stageIdx))) return null;
    if (!isFinite(s.playerPoints)) return null;
    return s;
}
function clearSave(group) { const o = loadSaves(); if (o[group]) { delete o[group]; writeSaves(o); } }
// Guarda el progreso: comp.k ya es la prueba terminada, la partida retoma en la siguiente
function saveProgress() {
    const o = loadSaves();
    o[comp.group] = {
        v: 1, mode: comp.mode, group: comp.group, order: comp.order.slice(), k: comp.k + 1,
        results: JSON.parse(JSON.stringify(comp.results)), playerPoints: comp.playerPoints || 0,
        rivals: comp.rivals.map(function (r) { return { id: r.id, name: r.name, veh: r.veh, ratio: r.ratio, points: r.points, totalTime: r.totalTime }; }),
        damage: damage, veh: selVeh, diff: selDiff, savedAt: Date.now()
    };
    return writeSaves(o);
}
let menuNote = '';
let contSig = null;   // firma de las opciones del selector de partida, para reconstruirlo solo cuando cambian
function contLabelName() { return selMode === 0 ? 'campeonato' : 'rally'; }
// Arma el selector "Nuevo / Continuar" según el modo y la partida guardada. Devuelve la partida si se elige continuar.
function refreshCont() {
    const row = document.getElementById('rowCont'), sel = document.getElementById('selectCont');
    const vs = document.getElementById('selectVehicle'), ds = document.getElementById('selectDifficulty');
    let snap = null;
    if (row && sel && selMode <= 1) {
        snap = getSave(selGroup);
        const sig = selMode + '|' + selGroup + '|' + (snap ? snap.savedAt + '|' + snap.k : '-');
        row.classList.remove('hidden');
        if (sig !== contSig) {
            contSig = sig;
            const nm = contLabelName();
            let h = '<option value="0">Nuevo ' + nm + '</option>';
            if (snap) h += '<option value="1">Continuar ' + nm + ' · prueba ' + (snap.k + 1) + '/' + snap.order.length + ' · ' + carShort(snap.veh) + ' · ' + ['Fácil', 'Media', 'Difícil'][snap.diff] + '</option>';
            sel.innerHTML = h;
            sel.value = snap ? '1' : '0';
        }
        if (!(snap && sel.value === '1')) snap = null;
    } else {
        if (row) row.classList.add('hidden');
        contSig = null;
    }
    if (vs && ds) {
        if (snap) { vs.value = String(snap.veh); ds.value = String(snap.diff); }
        vs.disabled = !!snap;
        ds.disabled = !!snap || selMode === 3;
    }
    return snap;
}

function startCompetition() {
    readMenu();
    const snap = refreshCont();
    if (snap) readMenu();   // toma el auto y la dificultad de la partida guardada
    if (!snap && selMode <= 1 && getSave(selGroup)) {
        let ok = true;
        try { if (typeof confirm === 'function') ok = confirm('Ya tenés un ' + contLabelName() + ' guardado. Si empezás uno nuevo, el guardado se borra. ¿Empezar de cero?'); } catch (e) {}
        if (!ok) return;
        clearSave(selGroup);
    }
    try { const a = getAC(); if (a.state === 'suspended') a.resume(); } catch (e) {}
    menuNote = '';
    if (snap) {
        comp = { mode: selMode, group: selGroup, tt: false, order: selOrder.slice(), k: snap.k,
                 results: JSON.parse(JSON.stringify(snap.results)), playerPoints: snap.playerPoints,
                 rivals: snap.rivals.map(function (r) { return { id: r.id, name: r.name, veh: r.veh, ratio: r.ratio, points: r.points, totalTime: r.totalTime }; }) };
        damage = snap.damage || 0;   // startStage aplica la reparación del equipo (comp.k > 0)
        startStage(comp.order[comp.k], false);
        return;
    }
    comp = { mode: selMode, group: selGroup, tt: selMode === 3, order: selOrder.slice(), k: 0, results: [], playerPoints: 0,
             rivals: selMode === 3 ? [] : createCompRivals() };
    damage = 0;
    startStage(comp.order[0], false);
}

// ---------------- contrarreloj: récord guardado + auto de sombra ----------------
function ghostKey(idx) { return 't' + idx + '_' + selVeh; }
function setupGhost() {
    ghostCar = null; ghostRec = null; runGhost = { p: [0], x: [0] }; ghostAcc = 0;
    if (!comp.tt) return;
    const e = loadRecords()[ghostKey(stageIdx)];
    if (e && e.g && e.g.d && e.g.d.length > 1 && e.time != null) {
        const cum = [0]; for (let i = 0; i < e.g.d.length; i++) cum.push(cum[i] + e.g.d[i]);
        e.g.p = cum;   // posiciones absolutas (en disco solo se guardan las diferencias)
        ghostRec = e;
        ghostCar = { ghost: true, id: -1, z: PLAYER_Z, x: e.g.x[0] / 100, veh: selVeh, v: 0 };
    }
}
function updateGhost(dt) {
    if (!comp.tt) return;
    if (gameState === 'RUNNING') {
        ghostAcc += dt;
        while (ghostAcc >= GHOST_DT - 1e-9) {
            ghostAcc -= GHOST_DT;
            runGhost.p.push(Math.round(position)); runGhost.x.push(Math.round(playerX * 100));
        }
    }
    if (ghostRec) {
        const gp = ghostRec.g.p, gx = ghostRec.g.x, f = stageTime / ghostRec.g.dt;
        const i = Math.min(Math.floor(f), gp.length - 1), j = Math.min(i + 1, gp.length - 1), u = Math.min(1, Math.max(0, f - i));
        ghostCar.z = PLAYER_Z + gp[i] + (gp[j] - gp[i]) * u;
        ghostCar.x = (gx[i] + (gx[j] - gx[i]) * u) / 100;
    }
}
// Diferencia con la sombra en la misma posición de la pista: + = vas atrás, - = vas adelante (segundos)
function ghostDelta() {
    if (!ghostRec) return null;
    const gp = ghostRec.g.p, dt = ghostRec.g.dt;
    if (position <= gp[0]) return 0;
    let lo = 0, hi = gp.length - 1;
    if (position >= gp[hi]) return stageTime - hi * dt;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (gp[mid] >= position) hi = mid; else lo = mid; }
    const tg = (lo + (position - gp[lo]) / ((gp[hi] - gp[lo]) || 1)) * dt;
    return stageTime - tg;
}

function startStage(idx, isRetry) {
    stageIdx = idx;
    stage = getTrack(idx);
    setTheme(stage);
    position = 0; playerX = 0; vx = 0; speed = 0; steerInput = 0; slip = 0;
    stageTime = 0; nextCp = 0; lapNo = 0; lapTimes = []; lapStartTime = 0;
    noteAnnounced = {}; lastFeature = ''; lastIdx = -1;
    crashCooldown = 0; crashFlash = 0; particles = []; popup.t = 0;
    rpm = 1200; gear = 1; bgX = 0; stageResult = null;
    for (const sg of stage.segs) for (const ob of sg.objs) ob.down = false;   // carteles derribados vuelven a su lugar
    if (isRetry) damage = stageStartDamage;
    else if (comp.k > 0) damage = Math.round(damage * DAMAGE_CARRY);   // el equipo repara gran parte del daño
    stageStartDamage = damage;
    spawnRivals();
    setupGhost();

    const veh = selVeh, d = DIFFS[selDiff];
    cpBonus = [];
    if (stage.mode === 'circuit') {
        lapAllow = refTime(stage, veh, d.allow, 0, stage.N);        // cada vuelta suma ese tiempo
        timeLeft = lapAllow + 8;
    } else {
        const b = [0].concat(stage.cps, [stage.finishSeg]);
        timeLeft = refTime(stage, veh, d.allow, b[0], b[1]) + 8;
        for (let j = 0; j < stage.cps.length; j++) cpBonus.push(refTime(stage, veh, d.allow, b[j + 1], b[j + 2]));
    }

    if (comp.tt) timeLeft = 1e9;   // contrarreloj: sin límite de tiempo, solo vos contra tu récord
    countdown = 3.6; lastCountNum = 4;
    gameState = 'COUNTDOWN';
    document.getElementById('menuStart').classList.add('hidden');
    document.getElementById('menuResult').classList.add('hidden');
    startEngine(); startMusic();
    if (voiceMode === 0) setTimeout(function () {
        speak((comp.tt ? 'Contrarreloj, ' : '') + (stage.mode === 'circuit' ? 'Circuito, ' : 'Etapa, ') + stage.def.name + (stage.mode === 'circuit' ? ', ' + stage.laps + ' vueltas' : ''));
    }, 300);
}

function showResult(title, text, victory, primaryLabel, primaryFn, secondaryLabel, secondaryFn, midLabel, midFn) {
    const t = document.getElementById('resTitle');
    t.innerText = title;
    t.style.color = victory ? ACCENT : '#ff3d5a';
    document.getElementById('resText').innerText = text;
    const nLines = text.split('\n').length;
    document.getElementById('resText').style.fontSize = nLines > 22 ? '0.68rem' : nLines > 11 ? '0.8rem' : '';
    const b1 = document.getElementById('btnResPrimary'), b2 = document.getElementById('btnResSecondary');
    b1.innerText = primaryLabel; b1.onclick = primaryFn;
    if (secondaryLabel) { b2.classList.remove('hidden'); b2.innerText = secondaryLabel; b2.onclick = secondaryFn; }
    else { b2.classList.add('hidden'); b2.onclick = null; }
    const bm = document.getElementById('btnResMid');
    if (bm) {
        if (midLabel) { bm.classList.remove('hidden'); bm.innerText = midLabel; bm.onclick = midFn; }
        else { bm.classList.add('hidden'); bm.onclick = null; }
    }
    document.getElementById('menuResult').classList.remove('hidden');
}


function backToMenu() {
    stopAllAudio();
    rivals = []; ghostCar = null; ghostRec = null;
    gameState = 'START';
    keys.left = keys.right = keys.up = keys.down = false;
    document.getElementById('menuResult').classList.add('hidden');
    document.getElementById('menuStart').classList.remove('hidden');
    updateMenu();
}
window.backToMenu = backToMenu;

function failStage(msg) {
    gameState = 'ENDED';
    stopAllAudio();
    showResult(stage.mode === 'circuit' ? 'CARRERA FALLIDA' : 'ETAPA FALLIDA', msg, false,
        'REINTENTAR', function () { startStage(comp.order[comp.k], true); }, 'VOLVER AL MENÚ', backToMenu);
}

function crash(dmg, spdMul) {
    if (crashCooldown > 0) return;
    speed *= spdMul;
    damage = Math.min(100, damage + dmg);
    crashCooldown = 0.6; crashFlash = 0.35;
    playCrashSound();
    if (damage >= 100) failStage('VEHÍCULO AVERIADO\nEl daño llegó al 100%.');
}


// Se llama en el instante de cruzar la meta: fija el resultado y arranca el frenado
function onFinish() {
    gameState = 'FINISHING'; finishTimer = 0;
    const circ = stage.mode === 'circuit';
    const t = stageTime;
    if (circ) lapTimes.push(t - lapStartTime);
    const bestLap = circ ? Math.min.apply(null, lapTimes) : null;
    if (comp.tt) { onFinishTT(t, circ, bestLap); return; }
    const recs = loadRecords();
    const key = 'e' + stageIdx + '_' + selVeh + '_' + selDiff;
    const e = recs[key] || {};
    const newRecord = (e.race == null || t < e.race);
    const newLapRecord = circ && (e.lap == null || bestLap < e.lap);
    if (newRecord) e.race = t;
    if (newLapRecord) e.lap = bestLap;
    recs[key] = e; saveRecords(recs);
    // Clasificación: los rivales que ya cruzaron la meta tienen su tiempo; a los demás se les proyecta
    const entriesT = [{ name: 'TÚ', player: true, time: t }];
    rivals.forEach(function (r) { entriesT.push({ name: r.name, veh: r.veh, id: r.id, time: projectRivalFinish(r) }); });
    entriesT.sort(function (a, b) { return a.time - b.time; });
    const rank = entriesT.findIndex(function (x) { return x.player; }) + 1;
    const pts = STAGE_POINTS[rank - 1] || 0;
    const medal = medalForRank(rank);   // la medalla es por posición de llegada, no por tiempo
    comp.playerPoints = (comp.playerPoints || 0) + pts;
    entriesT.forEach(function (x, i) {
        if (x.player) return;
        comp.rivals[x.id].points += STAGE_POINTS[i] || 0;
        comp.rivals[x.id].totalTime += x.time;
    });
    stageResult = { stageIdx: stageIdx, kind: stage.mode, time: t, laps: lapTimes.slice(), bestLap: bestLap, medal: medal,
                    damage: Math.round(damage), newRecord: newRecord, newLapRecord: newLapRecord, rank: rank, points: pts, table: entriesT };
    comp.results[comp.k] = stageResult;
    popup = { t: 3, text: 'META', sub: formatTime(t) };
    playFinishSound();
    cancelSpeech();
}

// Contrarreloj: guarda récord + sombra si mejoraste, y deja el resultado listo para mostrar
function onFinishTT(t, circ, bestLap) {
    const recs = loadRecords();
    const key = ghostKey(stageIdx);
    const e = recs[key] || {};
    const prev = e.time;
    const newRecord = (prev == null || t < prev);
    const newLapRecord = circ && (e.lap == null || bestLap < e.lap);
    let saved = true;
    if (newRecord) {
        const n = Math.round(t / GHOST_DT);
        while (runGhost.p.length - 1 < n) { runGhost.p.push(Math.round(position)); runGhost.x.push(Math.round(playerX * 100)); }
        const dp = []; for (let i = 1; i < runGhost.p.length; i++) dp.push(runGhost.p[i] - runGhost.p[i - 1]);
        e.time = t; e.g = { dt: GHOST_DT, d: dp, x: runGhost.x.slice() };
    }
    if (newLapRecord) e.lap = bestLap;
    if (newRecord || newLapRecord) { recs[key] = e; saved = saveRecords(recs); }
    stageResult = { stageIdx: stageIdx, kind: stage.mode, tt: true, time: t, laps: lapTimes.slice(), bestLap: bestLap, prev: prev,
                    damage: Math.round(damage), newRecord: newRecord, newLapRecord: newLapRecord, saved: saved, rank: 1, points: 0, medal: '', table: [] };
    comp.results[comp.k] = stageResult;
    popup = { t: 3, text: newRecord ? '¡NUEVO RÉCORD!' : 'META', sub: formatTime(t) };
    playFinishSound();
    cancelSpeech();
}

function finishTimeTrial() {
    gameState = 'ENDED';
    stopAllAudio();
    const r = stageResult, circ = r.kind === 'circuit', def = EVENTS[r.stageIdx];
    let text = 'Tiempo: ' + formatTime(r.time) + (r.newRecord ? '  ★ NUEVO RÉCORD' : '');
    if (r.prev != null) {
        const d = r.time - r.prev;
        text += '\nRécord anterior: ' + formatTime(r.prev) + '  (' + (d <= 0 ? '-' : '+') + Math.abs(d).toFixed(2) + ' s)';
    } else text += '\nPrimer registro: queda como récord y como sombra';
    if (circ) {
        text += '\nVueltas: ' + r.laps.map(function (t) { return formatTime(t); }).join(' · ') +
            '\nMejor vuelta: ' + formatTime(r.bestLap) + (r.newLapRecord ? '  ★ RÉCORD' : '');
    }
    text += '\nDaño: ' + r.damage + '%';
    if (r.newRecord) text += '\n\nTu sombra ahora es esta carrera: en el próximo intento vas a correr contra ella.';
    else text += '\n\nLa sombra sigue siendo tu mejor tiempo (' + formatTime(r.prev) + ').';
    if (!r.saved) text += '\n\n⚠ No se pudo guardar el récord (almacenamiento del navegador bloqueado o lleno).';
    const label = 'CONTRARRELOJ · ' + def.name.toUpperCase();
    showResult(r.newRecord ? '¡NUEVO RÉCORD!' : label, text, true, 'REINTENTAR', function () { startStage(comp.order[0], false); }, 'VOLVER AL MENÚ', backToMenu);
}

function carShort(v) { return ['Escarabajo', 'Coupé GT', 'V12 Hypercar'][v]; }
function padRight(str, n) { str = String(str); while (str.length < n) str += ' '; return str; }


// Clasificación del campeonato: puntos y, a igualdad, menor tiempo total
function standingsList() {
    const list = [{ name: 'TÚ', player: true, points: comp.playerPoints || 0,
                    total: comp.results.reduce(function (a, x) { return a + x.time; }, 0) }];
    comp.rivals.forEach(function (cr) { list.push({ name: cr.name, veh: cr.veh, points: cr.points, total: cr.totalTime }); });
    list.sort(function (a, b) { return (b.points - a.points) || (a.total - b.total); });
    return list;
}

function finishStage() {
    if (comp.tt) { finishTimeTrial(); return; }
    gameState = 'ENDED';
    stopAllAudio();
    const r = stageResult;
    const circ = r.kind === 'circuit';
    const def = EVENTS[r.stageIdx];
    const last = comp.k >= comp.order.length - 1;
    const multi = comp.order.length > 1;
    const sumTime = comp.results.reduce(function (a, x) { return a + x.time; }, 0);
    let text = 'Tiempo: ' + formatTime(r.time) + (r.newRecord ? '  ★ RÉCORD' : '') +
        '\nPosición: P' + r.rank + ' de ' + r.table.length + '  (+' + r.points + ' pts)' +
        '\nMedalla: ' + r.medal + (r.rank <= 3 ? '  (P' + r.rank + ')' : '');
    if (circ) {
        text += '\nVueltas: ' + r.laps.map(function (t) { return formatTime(t); }).join(' · ') +
            '\nMejor vuelta: ' + formatTime(r.bestLap) + (r.newLapRecord ? '  ★ RÉCORD' : '');
    }
    text += '\nDaño: ' + r.damage + '%' + '\n\nCLASIFICACIÓN';
    r.table.forEach(function (e, i) {
        text += '\n' + (i + 1) + '. ' + padRight(e.player ? 'TÚ' : e.name + ' (' + carShort(e.veh) + ')', 25) + formatTime(e.time);
    });
    if (multi) {
        const st = standingsList();
        text += '\n\nCampeonato: P' + (st.findIndex(function (e) { return e.player; }) + 1) + ' con ' + (comp.playerPoints || 0) + ' pts · acumulado ' + formatTime(sumTime);
    }
    const label = (circ ? 'CARRERA' : 'ETAPA') + ' COMPLETADA · ' + def.name.toUpperCase();

    if (!last) {
        if (r.damage > 0) text += '\nEl equipo repara parte del daño: ' + r.damage + '% → ' + Math.round(r.damage * DAMAGE_CARRY) + '%';
        showResult('PRUEBA ' + (comp.k + 1) + '/' + comp.order.length + ' · ' + label, text, true,
            'SIGUIENTE PRUEBA', function () { comp.k++; startStage(comp.order[comp.k], false); }, 'ABANDONAR', backToMenu,
            multi && comp.group !== 'one' ? 'GUARDAR Y SALIR' : null, function () {
                const done = comp.k + 1, tot = comp.order.length, nm = comp.mode === 0 ? 'campeonato' : 'rally';
                if (!saveProgress()) {
                    const b = document.getElementById('btnResMid');
                    if (b) b.innerText = 'NO SE PUDO GUARDAR';
                    return;
                }
                menuNote = '✔ ' + nm.charAt(0).toUpperCase() + nm.slice(1) + ' guardado: ' + done + '/' + tot + ' pruebas hechas. Elegí "Continuar" para seguir.';
                backToMenu();
            });
        return;
    }
    if (!multi) {
        showResult(label, text, true, 'VOLVER AL MENÚ', backToMenu, 'REPETIR', function () {
            comp.k = 0; comp.results = []; comp.playerPoints = 0; comp.rivals = createCompRivals();
            damage = 0; startStage(comp.order[0], false);
        });
        return;
    }
    // Final del campeonato
    clearSave(comp.group);
    const recs = loadRecords();
    const ck = 'c' + comp.group + '_' + selVeh + '_' + selDiff;
    const newChamp = (recs[ck] == null || sumTime < recs[ck]);
    if (newChamp) { recs[ck] = sumTime; saveRecords(recs); }
    const counts = { ORO: 0, PLATA: 0, BRONCE: 0 };
    comp.results.forEach(function (x) { if (counts[x.medal] !== undefined) counts[x.medal]++; });
    const st = standingsList();
    const myPos = st.findIndex(function (e) { return e.player; }) + 1;
    let fin = '';
    comp.results.forEach(function (x, i) {
        fin += (i ? '\n' : '') + padRight((i + 1) + '.', 4) + padRight(SHORT_NAMES[x.stageIdx], 13) + formatTime(x.time) + '  P' + x.rank + '  [' + x.medal + ']';
    });
    fin += '\n\nCLASIFICACIÓN FINAL';
    st.forEach(function (e, i) {
        fin += '\n' + (i + 1) + '. ' + padRight(e.player ? 'TÚ' : e.name + ' (' + carShort(e.veh) + ')', 25) + padRight(e.points + ' pts', 8) + formatTime(e.total);
    });
    fin += '\n\nMedalla del campeonato: ' + medalForRank(myPos) + '  (P' + myPos + ')' +
        '\nTiempo total: ' + formatTime(sumTime) + (newChamp ? '  ★ RÉCORD' : '') +
        '\nMedallas de prueba: ' + counts.ORO + ' oro, ' + counts.PLATA + ' plata, ' + counts.BRONCE + ' bronce';
    const title = myPos === 1 ? (counts.ORO === comp.order.length ? '¡CAMPEÓN PERFECTO!' : '¡CAMPEÓN!')
                : myPos <= 3 ? '¡PODIO: P' + myPos + '!' : 'CAMPEONATO FINALIZADO · P' + myPos;
    showResult(title, fin, true, 'VOLVER AL MENÚ', backToMenu, null, null);
}

// ---------------------------------------------------------------------------
// RIVALES DE IA
// Cada rival conduce uno de los 3 autos y sigue el perfil de velocidad ideal de la pista multiplicado por su ritmo
// (el rango depende de la dificultad). Largan adelante tuyo (salís último en la parrilla). En circuitos dan vueltas.
// Se mueven de lado, no se bloquean entre sí y chocan con vos.
// ---------------------------------------------------------------------------
const RIVAL_NAMES = ['Álvarez', 'Benítez', 'Castro', 'Duarte'];
const RIVAL_COLORS = ['#ff2a00', '#0066ff', '#ccaa00'];
const STAGE_POINTS = [10, 7, 5, 3, 1];
// Los rivales largan RIVAL_LAUNCH segundos antes del ¡YA! (como en el juego 1): al arrancar vos ya vienen en carrera y no te los comés de entrada
const RIVAL_LAUNCH = 3.0;
const RIVAL_LANES = [-0.5, 0.5, -0.5, 0.5];
const RIVAL_HIT_X = 0.42;        // solapamiento lateral para que haya choque
const RIVAL_HIT_BEHIND = 180;    // unidades de mundo detrás de tu auto
const RIVAL_HIT_AHEAD = 380;     // unidades de mundo delante de tu auto

// Pilotos del campeonato: mismo auto y ritmo en todas las pruebas, con puntos acumulados
function createCompRivals() {
    const d = DIFFS[selDiff];
    const cars = [0, 1, 2, Math.floor(Math.random() * 3)];
    for (let i = cars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = cars[i]; cars[i] = cars[j]; cars[j] = tmp;
    }
    return RIVAL_NAMES.map(function (name, i) {
        const f = (i + 0.2 + Math.random() * 0.6) / RIVAL_NAMES.length;   // repartidos a lo largo del rango
        return { id: i, name: name, veh: cars[i], ratio: d.rival[0] + (d.rival[1] - d.rival[0]) * f, points: 0, totalTime: 0 };
    });
}

function spawnRivals() {
    raceClock = 0; raceT0 = 0;
    rivals = comp.rivals.map(function (cr, i) {
        return {
            id: cr.id, name: cr.name, veh: cr.veh,
            ratio: cr.ratio * (0.985 + Math.random() * 0.03),
            x: RIVAL_LANES[i], lane: RIVAL_LANES[i], baseLane: RIVAL_LANES[i], pushX: 0,
            z: PLAYER_Z + 500 + i * 500, v: 0, finished: false, time: null,   // z = distancia total recorrida (todas las vueltas)
            profile: idealSpeeds(stage, cr.veh)
        };
    });
}

function stepRival(r, clock, dt) {
    const circ = stage.mode === 'circuit';
    const zl = circ ? r.z % stage.TL : r.z;
    const idx = clamp(Math.floor(zl / SEG_LEN), 0, stage.N - 1);
    const veh = VEHICLES[r.veh];
    let target = 0;
    if (!r.finished && (circ || idx < stage.finishSeg)) target = r.profile[idx] * r.ratio * (1 + 0.03 * Math.sin(clock * 0.5 + r.id * 1.7));
    if (target > r.v) r.v = Math.min(target, r.v + veh.a0 * 0.9 * dt);
    else r.v = Math.max(target, r.v - veh.brake * 0.8 * dt);
    r.z += r.v * KMH_WORLD * dt;
    if (!circ) r.z = Math.min(r.z, (stage.N - 3) * SEG_LEN);
    // Cortesía: si el rival te viene alcanzando por atrás, se corre al lado libre para pasarte sin chocarte;
    // cuando ya te pasó (o está lejos) vuelve a su carril. No cambia su velocidad, solo su posición lateral.
    let wantLane = r.baseLane;
    if (gameState === 'RUNNING') {
        const dzP = r.z - (position + PLAYER_Z);
        if (dzP < -40 && dzP > -1300 && r.v > speed - 5) wantLane = playerX >= 0 ? -0.6 : 0.6;
    }
    r.lane += clamp(wantLane - r.lane, -0.9 * dt, 0.9 * dt);
    r.pushX *= Math.pow(0.05, dt);
    r.x = clamp(r.lane + Math.sin(clock * 0.8 + r.id * 2.1) * 0.14 + r.pushX, -0.85, 0.85);   // vaivén lateral
    if (!r.finished && r.z >= raceGoal()) { r.finished = true; r.time = clock - raceT0; }
}

function updateRivals(dt) {
    raceClock += dt;
    for (let i = 0; i < rivals.length; i++) stepRival(rivals[i], raceClock, dt);
}

// Tiempo de meta de un rival: el real si ya cruzó, o proyectado sobre una copia (los rivales reales siguen corriendo)
function projectRivalFinish(r) {
    if (r.finished) return r.time;
    const c = Object.assign({}, r);
    let clock = raceClock, guard = 0;
    while (!c.finished && guard < 60 * 900) { clock += STEP; stepRival(c, clock, STEP); guard++; }
    return c.finished ? c.time : clock - raceT0;
}

function currentRank() {
    const pz = position + PLAYER_Z;
    let rank = 1;
    for (let i = 0; i < rivals.length; i++) if (rivals[i].z > pz) rank++;
    return rank;
}

// Choque con un rival: -45% velocidad, +12% daño y empujón a ambos autos (igual que en los juegos 1 y 2)
function checkRivalCollisions() {
    const pz = position + PLAYER_Z;
    for (let i = 0; i < rivals.length; i++) {
        const r = rivals[i];
        const dz = r.z - pz;
        if (dz < -RIVAL_HIT_BEHIND || dz > RIVAL_HIT_AHEAD) continue;
        const dxp = playerX - r.x;
        if (Math.abs(dxp) >= RIVAL_HIT_X) continue;
        if (crashCooldown > 0) return false;
        crash(12, 0.55);
        const push = dxp !== 0 ? Math.sign(dxp) : (Math.random() < 0.5 ? -1 : 1);
        playerX += push * 0.4;
        r.pushX -= push * 0.15;
        return true;
    }
    return false;
}

function drawRival(r, seg, alpha) {
    if (r.ghost) alpha *= 0.5;   // auto de sombra: translúcido
    const pct = (r.z % SEG_LEN) / SEG_LEN, a = seg.p1.screen, b = seg.p2.screen;
    const sc = a.scale + (b.scale - a.scale) * pct;
    if (sc <= 0) return;
    const sx = a.x + (b.x - a.x) * pct + sc * r.x * ROAD_W * WIDTH / 2;
    const sy = a.y + (b.y - a.y) * pct;
    const k = sc * WIDTH / 2;
    const bw = 760 * k, bh = 600 * k;
    if (bw < 3 || sy < 0 || sx < -500 || sx > WIDTH + 500) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(sx, sy, bw * 0.46, Math.max(1, bw * 0.05), 0, 0, Math.PI * 2); ctx.fill();
    const img = carImgs[r.veh];
    if (img && img.complete && img.naturalWidth) {
        const d = fitDims(img, bw, bh);
        ctx.drawImage(img, sx - d.w / 2, sy - d.h, d.w, d.h);
    } else {
        ctx.fillStyle = RIVAL_COLORS[r.veh];
        ctx.fillRect(sx - bw * 0.4, sy - bh * 0.7, bw * 0.8, bh * 0.7);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// FÍSICA
// ---------------------------------------------------------------------------
function emitParticle(color, size, life) {
    if (particles.length > 90) return;
    particles.push({
        x: WIDTH / 2 + (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25) + steerInput * 30,
        y: HEIGHT - 55 - Math.random() * 10,
        vx: (Math.random() - 0.5) * 60 - vx * 20, vy: -25 - Math.random() * 45,
        life: life, max: life, size: size, color: color
    });
}

function updateRpm(dt) {
    const veh = VEHICLES[selVeh];
    const ratio = clamp(speed / veh.top, 0, 1.05);
    const g = Math.min(5, Math.floor(ratio * 5 * 0.98) + 1);
    const within = clamp(ratio * 5 * 0.98 - (g - 1), 0, 1);
    let target = 1900 + within * (veh.rpmMax - 1900);
    if (gameState === 'COUNTDOWN') target = keys.up ? veh.rpmMax * 0.6 : 1200;
    else if (speed < 3 && !keys.up) target = 1200;
    else if (!keys.up) target = Math.max(1300, target * 0.85);
    gear = g;
    rpm += (target - rpm) * Math.min(1, dt * 10);
}


function updatePhysics(dt) {
    if (!stage) return;
    if (crashCooldown > 0) crashCooldown -= dt;
    if (crashFlash > 0) crashFlash -= dt;
    if (popup.t > 0) popup.t -= dt;

    if (gameState === 'COUNTDOWN') {
        countdown -= dt;
        const num = Math.ceil(countdown - 0.6);
        if (num !== lastCountNum) { lastCountNum = num; if (num >= 1) beep(440, 0.15); }
        if (countdown - 0.6 <= RIVAL_LAUNCH) updateRivals(dt);   // los rivales ya están corriendo en los últimos RIVAL_LAUNCH s de la cuenta
        if (countdown <= 0.6) {
            raceT0 = raceClock;                                   // los tiempos de los rivales se miden desde el ¡YA!, igual que el tuyo
            gameState = 'RUNNING';
            beep(880, 0.35);
            popup = { t: 1.0, text: '¡YA!', sub: '' };
        }
        updateRpm(dt); updateEngineAudio();
        return;
    }
    const finishing = (gameState === 'FINISHING');
    if (gameState !== 'RUNNING' && !finishing) return;
    updateRivals(dt);
    updateGhost(dt);

    const circ = stage.mode === 'circuit';
    const veh = VEHICLES[selVeh];
    const pzT = position + PLAYER_Z;                 // distancia total recorrida por el auto
    const idx = segIndexAt(pzT);
    const seg = stage.segs[idx];
    const surf = SURFACES[seg.surface];
    const vs = veh.surf[seg.surface];
    const effGrip = surf.grip * vs;
    const inTunnel = seg.tunnel, inBridge = seg.bridge;
    const offroad = !inTunnel && !inBridge && Math.abs(playerX) > 1.08;

    if (!finishing) {
        stageTime += dt; timeLeft -= dt;
        if (timeLeft <= 0) {
            timeLeft = 0;
            failStage('TIEMPO AGOTADO\n' + (circ ? 'No completaste la vuelta a tiempo.' : 'No llegaste al próximo checkpoint a tiempo.'));
            return;
        }
    } else {
        finishTimer += dt;
        if (finishTimer > 1.2 && (speed < 2 || finishTimer > 3.2)) { finishStage(); return; }
    }

    // ---- velocidad
    let maxEff = veh.top * surf.top * (1 - 0.25 * damage / 100);
    if (offroad) maxEff *= 0.55;
    const throttle = finishing ? false : keys.up;
    const braking = finishing ? true : keys.down;
    const slope = (seg.p2.world.y - seg.p1.world.y) / SEG_LEN;
    if (braking) {
        speed -= veh.brake * surf.brake * (finishing ? 0.7 : 1) * dt;
    } else if (throttle) {
        const x = Math.min(1, speed / maxEff);
        speed += (veh.a0 * surf.accel * (1 - Math.pow(x, 1.6)) + 2) * dt;
    } else {
        speed -= (14 + 0.30 * speed) * dt;
    }
    if (speed > 5) speed -= slope * 45 * dt;             // cuesta arriba frena, cuesta abajo ayuda
    if (speed > maxEff) speed = Math.max(maxEff, speed - 60 * dt);
    if (offroad) speed -= (10 + 0.25 * speed) * dt;
    speed = clamp(speed, 0, veh.top * 1.1);

    // ---- dirección y deslizamiento lateral
    const sr = speed / veh.top;
    let dir = 0;
    if (finishing) dir = playerX > 0.06 ? -1 : (playerX < -0.06 ? 1 : 0);
    else dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir !== 0) steerInput = clamp(steerInput + dir * dt * 5.5, -1, 1);
    else steerInput *= Math.pow(0.86, dt * 60);

    const authority = veh.steer * effGrip * (0.35 + 0.65 * Math.min(1, sr * 1.4));
    const targetLat = steerInput * authority * Math.min(1, speed / 8);
    vx += (targetLat - vx) * Math.min(1, (4 + 6 * effGrip) * dt);   // menos agarre = más inercia lateral
    const push = seg.curve * sr * 0.42 * surf.push / vs;             // fuerza centrífuga
    playerX += (vx - push) * dt;

    const overload = Math.abs(push) / Math.max(0.15, authority);
    slip = sr > 0.2 ? clamp((overload - 0.75) / 0.5, 0, 1) : 0;

    // ---- paredes: túnel y puente son angostos y no perdonan; en campo abierto hay una valla lejana
    const limitX = inTunnel ? TUNNEL_X : (inBridge ? BRIDGE_X : BARRIER_X);
    if (Math.abs(playerX) > limitX) {
        playerX = Math.sign(playerX) * limitX; vx = 0;
        crash(inTunnel || inBridge ? 8 : 6, 0.55);
        if (gameState === 'ENDED') return;
    }

    // ---- avance
    const prevZ = pzT;
    position += speed * KMH_WORLD * dt;
    if (!circ) {
        const maxPos = (stage.N - 3) * SEG_LEN - PLAYER_Z;
        if (position > maxPos) position = maxPos;
    }
    const newZ = position + PLAYER_Z;

    // ---- colisión con decorado (revisa todos los segmentos cruzados en este paso)
    if (!finishing) {
        const z0 = Math.floor(prevZ / SEG_LEN), z1 = Math.floor(newZ / SEG_LEN);
        for (let zi = z0; zi <= z1; zi++) {
            const sg = stage.segs[circ ? zi % stage.N : clamp(zi, 0, stage.N - 1)];
            const objs = sg.objs;
            for (let k = 0; k < objs.length; k++) {
                const o = objs[k];
                if (o.hitW > 0 && !o.down && Math.abs(playerX - o.offset) < o.hitW + 0.15) {
                    if (o.kind === 'chevron' || o.kind === 'lamp') { o.down = true; crash(3, 0.82); }   // carteles y farolas se derriban: golpe leve, una sola vez
                    else crash(o.kind === 'rock' || o.kind === 'mesa' ? 9 : 12, 0.45);
                    playerX += (playerX >= o.offset ? 1 : -1) * 0.25;
                    if (gameState === 'ENDED') return;
                    break;
                }
            }
        }
    }

    // ---- choque con rivales de IA
    if (!finishing) {
        checkRivalCollisions();
        if (gameState === 'ENDED') return;
    }

    // ---- vueltas, checkpoints y meta
    if (!finishing) {
        if (circ) {
            const lapNow = Math.floor(newZ / stage.TL);
            if (lapNow > lapNo && newZ < raceGoal()) {
                lapNo = lapNow;
                const lt = stageTime - lapStartTime;
                lapTimes.push(lt); lapStartTime = stageTime;
                timeLeft += lapAllow;
                popup = { t: 2.4, text: 'VUELTA ' + lapNo + '/' + stage.laps, sub: formatTime(lt) + (lt <= Math.min.apply(null, lapTimes) ? '  ★ MEJOR' : '') };
                playCheckpointSound();
            }
        } else {
            while (nextCp < stage.cps.length && newZ >= stage.cps[nextCp] * SEG_LEN) {
                timeLeft += cpBonus[nextCp];
                popup = { t: 2.2, text: 'CHECKPOINT', sub: '+' + Math.round(cpBonus[nextCp]) + ' s' };
                playCheckpointSound();
                nextCp++;
            }
        }
        if (newZ >= raceGoal()) { onFinish(); }
    }

    // ---- copiloto, avisos de túnel/puente y juntas del puente
    if (!finishing) {
        updateCopilot();
        const feat = inTunnel ? 'tunnel' : (inBridge ? 'bridge' : '');
        if (feat !== lastFeature) {
            if (feat) popup = { t: 1.4, text: feat === 'tunnel' ? 'TÚNEL' : 'PUENTE', sub: '' };
            lastFeature = feat;
        }
        if (inBridge && idx !== lastIdx && idx % 22 === 0 && speed > 40) playThump();
    }
    lastIdx = idx;

    // ---- efectos
    bgX -= seg.curve * sr * dt * 30;
    if (speed > 25) {
        if (offroad) { if (Math.random() < 0.5) emitParticle('#9e7a44', 4 + Math.random() * 4, 0.6); }
        else if (seg.surface === 'gravel') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle(curTheme.surfColors && curTheme.surfColors.gravel ? curTheme.surfColors.gravel.road[0] : '#c9a56a', 4 + Math.random() * 5, 0.7); }
        else if (seg.surface === 'snow') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle('#ffffff', 3 + Math.random() * 5, 0.7); }
        if (slip > 0.3 && seg.surface === 'asphalt' && Math.random() < 0.6) emitParticle('#d8d8d8', 3 + Math.random() * 4, 0.5);
        if ((inTunnel || inBridge) && Math.abs(playerX) > limitX - 0.05 && Math.random() < 0.5) emitParticle('#ffd27a', 2 + Math.random() * 2, 0.35);   // chispas contra la pared
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }

    updateRpm(dt);
    updateEngineAudio();
}


// ---------------------------------------------------------------------------
// RENDER (algoritmo del pintor: de lejos a cerca, así paredes, techos, barandas y autos tapan lo que corresponde)
// ---------------------------------------------------------------------------
function project(p, camX, camY, camZ) {
    const cx = p.world.x - camX, cy = p.world.y - camY, cz = p.world.z - camZ;
    p.camera.x = cx; p.camera.y = cy; p.camera.z = cz;
    const sc = cz > 0.0001 ? CAM_DEPTH / cz : 0;
    p.screen.scale = sc;
    p.screen.x = Math.round(WIDTH / 2 + sc * cx * WIDTH / 2);
    p.screen.y = Math.round(HEIGHT / 2 - sc * cy * HEIGHT / 2);
    p.screen.w = Math.round(sc * ROAD_W * WIDTH / 2);
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
}

function mountainH(u, layer) {
    const a = Math.sin(u * 0.013 + layer * 1.7) * 0.5 + Math.sin(u * 0.031 + layer * 3.1) * 0.3 + Math.sin(u * 0.071 + layer) * 0.2;
    return Math.abs(a);
}


function hash01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function drawBackground() {
    const horizonY = HEIGHT / 2;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, horizonY + 1);
    if (curTheme.stars) {
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
            ctx.globalAlpha = 0.45 + 0.35 * Math.sin(stageTime * 1.7 + s.tw);
            ctx.fillRect(s.x, s.y, s.s, s.s);
        }
        ctx.globalAlpha = 1;
    }
    const sun = curTheme.sun;
    if (sun) {
        const sx = ((sun.x * WIDTH + bgX * 0.15) % (WIDTH + 200) + (WIDTH + 200)) % (WIDTH + 200) - 100;
        ctx.fillStyle = sun.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(sx, horizonY - sun.y, sun.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    for (let layer = 0; layer < 2; layer++) {
        const f = layer === 0 ? 1 : 2;
        ctx.fillStyle = layer === 0 ? curTheme.mt1 : curTheme.mt2;
        if (curTheme.skyline) {
            // Ciudad de noche: edificios con ventanas encendidas que se desplazan con las curvas
            const w = layer === 0 ? 34 : 24, off = bgX * f, hMax = layer === 0 ? 70 : 46;
            const j0 = Math.floor(-off / w) - 1, j1 = Math.floor((WIDTH - off) / w) + 1;
            for (let j = j0; j <= j1; j++) {
                const bx = j * w + off, bh = 22 + hash01(j + layer * 100) * hMax;
                ctx.fillStyle = layer === 0 ? curTheme.mt1 : curTheme.mt2;
                ctx.fillRect(bx, horizonY - bh, w - 2, bh + 1);
                for (let wy = horizonY - bh + 5; wy < horizonY - 4; wy += 7) {
                    for (let wx = bx + 4; wx < bx + w - 6; wx += 7) {
                        if (hash01(j * 13.7 + wy * 0.31 + wx * 0.17 + layer) > 0.6) { ctx.fillStyle = layer === 0 ? '#ffd98a' : '#c9a85e'; ctx.fillRect(wx, wy, 2, 3); }
                    }
                }
            }
        } else {
            const amp = layer === 0 ? 85 : 50;
            ctx.beginPath();
            ctx.moveTo(0, horizonY + 1);
            for (let x = 0; x <= WIDTH; x += 8) ctx.lineTo(x, horizonY - (0.12 + mountainH(x - bgX * f, layer)) * amp);
            ctx.lineTo(WIDTH, horizonY + 1);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.fillStyle = curTheme.fog;
    ctx.fillRect(0, horizonY, WIDTH, HEIGHT - horizonY);
}

// Ruta de un segmento: suelo (césped / agua / oscuridad), bordes, calzada, marcas y niebla
function drawRoadSegment(seg, fogA) {
    const a = seg.p1.screen, b = seg.p2.screen, col = seg.colors;
    const x1 = a.x, y1 = a.y, w1 = a.w, x2 = b.x, y2 = b.y, w2 = b.w;
    const r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES), l2 = w2 / Math.max(32, 8 * LANES);
    const yb = y1 + 1;   // +1px: evita líneas finas entre segmentos

    ctx.fillStyle = col.grass;
    ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
    if (seg.bridge) {   // reflejos en el agua: franjas claras que corren a medida que avanzás
        ctx.fillStyle = seg.alt === 0 ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, y2, WIDTH, Math.max(1, (y1 - y2 + 1) * 0.5));
    }
    quad(x1 - w1 - r1, yb, x1 - w1, yb, x2 - w2, y2, x2 - w2 - r2, y2, col.rumble);
    quad(x1 + w1 + r1, yb, x1 + w1, yb, x2 + w2, y2, x2 + w2 + r2, y2, col.rumble);
    quad(x1 - w1, yb, x1 + w1, yb, x2 + w2, y2, x2 - w2, y2, col.road);

    if (seg.surface === 'asphalt') {
        if (seg.alt === 0) {
            const lw1 = w1 * 2 / LANES, lw2 = w2 * 2 / LANES;
            let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
            const lc = seg.tunnel ? '#a8a8b4' : '#f2f2f2';
            for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
                quad(lx1 - l1 / 2, yb, lx1 + l1 / 2, yb, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, lc);
            }
        }
    } else {
        const rut = seg.surface === 'gravel' ? 'rgba(0,0,0,0.13)' : 'rgba(80,110,150,0.16)';
        for (let s = -1; s <= 1; s += 2) {
            const c1 = x1 + s * w1 * 0.38, c2 = x2 + s * w2 * 0.38;
            quad(c1 - l1 * 2.2, yb, c1 + l1 * 2.2, yb, c2 + l2 * 2.2, y2, c2 - l2 * 2.2, y2, rut);
        }
    }
    if (fogA > 0.02) {
        ctx.globalAlpha = fogA;
        ctx.fillStyle = seg.tunnel ? '#06060a' : curTheme.fog;
        ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
        ctx.globalAlpha = 1;
    }
}

// Túnel: paredes, techo con luces y, en la entrada, el frente de roca (el hueco deja ver el interior)
function drawTunnelShell(seg, fogA) {
    const A = seg.p1.screen, B = seg.p2.screen;
    const hA = TUNNEL_H * A.scale * WIDTH / 2, hB = TUNNEL_H * B.scale * WIDTH / 2;
    const xlA = A.x - A.w * TUNNEL_X, xrA = A.x + A.w * TUNNEL_X, xlB = B.x - B.w * TUNNEL_X, xrB = B.x + B.w * TUNNEL_X;
    const yA = A.y, yB = B.y;
    const wallCol = seg.alt ? '#3a3d49' : '#33363f', ceilCol = seg.alt ? '#2a2c36' : '#252730';
    quad(xlA, yA, xlA, yA - hA, xlB, yB - hB, xlB, yB, wallCol);
    quad(xrA, yA, xrA, yA - hA, xrB, yB - hB, xrB, yB, wallCol);
    quad(xlA, yA - hA, xrA, yA - hA, xrB, yB - hB, xlB, yB - hB, ceilCol);
    if (seg.lamp) {   // luminarias del techo
        const cA = A.w * 0.2, cB = B.w * 0.2;
        quad(A.x - cA, yA - hA + 1, A.x + cA, yA - hA + 1, B.x + cB, yB - hB + 1, B.x - cB, yB - hB + 1, '#fff2b0');
        ctx.globalAlpha = 0.16;
        quad(xlA, yA - hA, xrA, yA - hA, xrB, yB - hB, xlB, yB - hB, '#ffe9a0');
        ctx.globalAlpha = 1;
    }
    if (fogA > 0.02) {   // la oscuridad crece con la distancia
        ctx.globalAlpha = Math.min(0.95, fogA);
        ctx.fillStyle = '#050509';
        ctx.beginPath(); ctx.moveTo(xlA, yA); ctx.lineTo(xlA, yA - hA); ctx.lineTo(xrA, yA - hA); ctx.lineTo(xrA, yA);
        ctx.lineTo(xrB, yB); ctx.lineTo(xrB, yB - hB); ctx.lineTo(xlB, yB - hB); ctx.lineTo(xlB, yB); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    }
    if (seg.tunnelStart) drawPortal(seg, xlA, xrA, yA, hA);
}
function drawPortal(seg, xl, xr, y, h) {
    const A = seg.p1.screen;
    const ox0 = A.x - A.w * TUNNEL_X * 1.9, ox1 = A.x + A.w * TUNNEL_X * 1.9;
    const top = y - h * 2.3, bottom = y + 2;
    ctx.fillStyle = '#6e6a63';
    ctx.beginPath();
    ctx.rect(ox0, top, ox1 - ox0, bottom - top);     // frente de roca
    ctx.rect(xl, y - h, xr - xl, h + 2);             // hueco del túnel
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';              // sombreado de la mitad inferior de la roca
    ctx.beginPath();
    ctx.rect(ox0, y - h * 1.15, ox1 - ox0, h * 1.15 + 2);
    ctx.rect(xl, y - h, xr - xl, h + 2);
    ctx.fill('evenodd');
    ctx.fillStyle = '#9b958a';                        // dintel
    ctx.fillRect(xl - A.w * 0.08, y - h - A.w * 0.12, (xr - xl) + A.w * 0.16, A.w * 0.12);
    if (h > 30) {
        ctx.fillStyle = '#ffcc33';
        const sw = (xr - xl) * 0.28, sh = h * 0.2;
        ctx.fillRect(A.x - sw / 2, y - h - A.w * 0.12 - sh * 1.15, sw, sh);
        ctx.font = 'bold ' + Math.max(8, Math.floor(sh * 0.7)) + 'px monospace';
        ctx.textAlign = 'center'; ctx.fillStyle = '#111';
        ctx.fillText('TÚNEL', A.x, y - h - A.w * 0.12 - sh * 0.35);
        ctx.textAlign = 'left';
    }
}

// Puente: parapeto con baranda, sombra sobre el agua y juntas
function drawBridgeParts(seg) {
    const A = seg.p1.screen, B = seg.p2.screen;
    const hA = RAIL_H * A.scale * WIDTH / 2, hB = RAIL_H * B.scale * WIDTH / 2;
    for (let s = -1; s <= 1; s += 2) {
        const xA = A.x + s * A.w * 1.04, xB = B.x + s * B.w * 1.04;
        // sombra del tablero sobre el agua
        quad(xA, A.y, xA + s * A.w * 0.5, A.y, xB + s * B.w * 0.5, B.y, xB, B.y, 'rgba(0,10,30,0.30)');
        // parapeto
        quad(xA, A.y, xA, A.y - hA, xB, B.y - hB, xB, B.y, seg.alt ? '#d8d6cd' : '#c3c1b8');
        ctx.strokeStyle = '#f2f0e8'; ctx.lineWidth = Math.max(1, A.w * 0.012);
        ctx.beginPath(); ctx.moveTo(xA, A.y - hA); ctx.lineTo(xB, B.y - hB); ctx.stroke();
    }
    if (seg.alt === 0 && A.w > 12) {   // junta de dilatación
        quad(A.x - A.w, A.y + 1, A.x + A.w, A.y + 1, B.x + B.w, B.y, B.x - B.w, B.y, 'rgba(0,0,0,0.20)');
    }
}
function drawArch(seg, alpha) {
    const a = seg.p1.screen, k = a.scale * WIDTH / 2;
    const half = ROAD_W * 1.06 * k, hgt = 3300 * k, th = Math.max(2, 130 * k);
    if (hgt < 6) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#c6483a'; ctx.lineWidth = th; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x - half, a.y); ctx.lineTo(a.x - half, a.y - hgt * 0.5);
    ctx.ellipse(a.x, a.y - hgt * 0.5, half, hgt * 0.5, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(a.x + half, a.y);
    ctx.stroke();
    ctx.strokeStyle = '#8f2f26'; ctx.lineWidth = Math.max(1, th * 0.4);
    for (let i = 1; i < 5; i++) {   // tirantes verticales
        const f = (i / 5) * 2 - 1, hx = a.x + f * half, topY = a.y - hgt * 0.5 - Math.sqrt(Math.max(0, 1 - f * f)) * hgt * 0.5;
        ctx.beginPath(); ctx.moveTo(hx, topY); ctx.lineTo(hx, a.y - RAIL_H * k); ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function tri(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
    ctx.fill(); ctx.stroke();
}

function drawObj(o, x, y, k) {
    const s = o.size;
    switch (o.kind) {
        case 'pine':
        case 'snowpine': {
            const h = 2300 * s * k, w = 1200 * s * k;
            if (h < 3) return;
            ctx.fillStyle = '#4a3018';
            ctx.fillRect(x - w * 0.06, y - h * 0.22, w * 0.12, h * 0.22);
            const snow = o.kind === 'snowpine';
            ctx.fillStyle = snow ? '#1f5a3a' : '#2f8a42';
            ctx.strokeStyle = '#0a2410';
            ctx.lineWidth = Math.max(1, w * 0.03);
            tri(x, y - h, x - w * 0.5, y - h * 0.30, x + w * 0.5, y - h * 0.30);
            tri(x, y - h * 0.68, x - w * 0.42, y - h * 0.12, x + w * 0.42, y - h * 0.12);
            if (snow) {
                ctx.fillStyle = '#f4f8fc';
                tri(x, y - h, x - w * 0.22, y - h * 0.72, x + w * 0.22, y - h * 0.72);
                tri(x, y - h * 0.68, x - w * 0.19, y - h * 0.44, x + w * 0.19, y - h * 0.44);
            }
            break;
        }
        case 'palm': {
            const h = 2100 * s * k, w = 1500 * s * k;
            if (h < 3) return;
            ctx.strokeStyle = '#6b4a26'; ctx.lineWidth = Math.max(1, w * 0.07);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.12, y - h * 0.5, x + w * 0.05, y - h); ctx.stroke();
            ctx.strokeStyle = '#2f9a48'; ctx.lineWidth = Math.max(1, w * 0.06);
            const tx = x + w * 0.05, ty = y - h;
            const ang = [-2.7, -2.1, -1.57, -1.0, -0.4];
            for (let i = 0; i < ang.length; i++) {
                ctx.beginPath(); ctx.moveTo(tx, ty);
                ctx.quadraticCurveTo(tx + Math.cos(ang[i]) * w * 0.35, ty + Math.sin(ang[i]) * w * 0.35 - w * 0.12, tx + Math.cos(ang[i]) * w * 0.55, ty + Math.sin(ang[i]) * w * 0.35 + w * 0.2);
                ctx.stroke();
            }
            break;
        }
        case 'bush': {
            const h = 650 * s * k, w = 900 * s * k;
            if (h < 2) return;
            const bc = curTheme.bushC || ['#3f8f3a', '#4fa848'];
            ctx.fillStyle = bc[0];
            ctx.beginPath(); ctx.ellipse(x - w * 0.22, y - h * 0.4, w * 0.3, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + w * 0.2, y - h * 0.45, w * 0.32, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = bc[1];
            ctx.beginPath(); ctx.ellipse(x, y - h * 0.55, w * 0.28, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'rock': {
            const h = 520 * s * k, w = 760 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#7d7f86'; ctx.strokeStyle = '#3b3c40'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.beginPath();
            ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h);
            ctx.lineTo(x + w * 0.25, y - h * 0.85); ctx.lineTo(x + w * 0.5, y - h * 0.25); ctx.lineTo(x + w * 0.45, y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.beginPath(); ctx.moveTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h); ctx.lineTo(x + w * 0.05, y - h * 0.6); ctx.closePath(); ctx.fill();
            break;
        }
        case 'hay': {
            const h = 480 * s * k, w = 800 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#d9b24a'; ctx.strokeStyle = '#8a6a1c'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h);
            ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.5); ctx.lineTo(x + w / 2, y - h * 0.5); ctx.stroke();
            break;
        }
        case 'chevron': {
            const h = 1300 * k, w = 700 * k;
            if (h < 4) return;
            ctx.fillStyle = '#555';
            ctx.fillRect(x - w * 0.03, y - h * 0.75, w * 0.06, h * 0.75);
            ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, w * 0.05);
            ctx.fillRect(x - w / 2, y - h, w, h * 0.5); ctx.strokeRect(x - w / 2, y - h, w, h * 0.5);
            ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, w * 0.09);
            const d = o.dir, cy = y - h * 0.75;
            ctx.beginPath();
            ctx.moveTo(x - d * w * 0.15, cy - h * 0.16); ctx.lineTo(x + d * w * 0.15, cy); ctx.lineTo(x - d * w * 0.15, cy + h * 0.16);
            ctx.stroke();
            break;
        }
        case 'lighthouse': {
            const h = 7000 * k, w = 1500 * k;
            if (h < 6) return;
            const bands = 6;
            for (let i = 0; i < bands; i++) {
                const y0 = y - h * (0.85 * (i + 1) / bands), hh = h * 0.85 / bands;
                const wt = w * (1 - 0.35 * (i / bands));
                ctx.fillStyle = i % 2 === 0 ? '#f4f4f4' : '#c8302a';
                ctx.fillRect(x - wt / 2, y0, wt, hh + 1);
            }
            ctx.fillStyle = '#2a2f3a'; ctx.fillRect(x - w * 0.34, y - h * 0.95, w * 0.68, h * 0.1);
            ctx.fillStyle = '#ffe98a'; ctx.fillRect(x - w * 0.22, y - h * 0.93, w * 0.44, h * 0.06);
            ctx.fillStyle = '#c8302a'; tri(x, y - h, x - w * 0.36, y - h * 0.95, x + w * 0.36, y - h * 0.95);
            break;
        }
        case 'cabin': {
            const h = 1800 * k, w = 2600 * k;
            if (h < 4) return;
            ctx.fillStyle = '#7a4a26'; ctx.fillRect(x - w / 2, y - h * 0.6, w, h * 0.6);
            ctx.fillStyle = '#f4f8fc'; ctx.strokeStyle = '#8fa3b8'; ctx.lineWidth = Math.max(1, w * 0.01);
            tri(x - w * 0.6, y - h * 0.6, x, y - h, x + w * 0.6, y - h * 0.6);
            ctx.fillStyle = '#ffd77a'; ctx.fillRect(x - w * 0.12, y - h * 0.45, w * 0.2, h * 0.22);
            break;
        }
    }
}

function drawGate(seg, k, sx, sy) {
    const half = ROAD_W * 1.12 * k;
    const postW = Math.max(2, 90 * k);
    const top = 2100 * k, bh = 520 * k;
    if (top < 4) return;
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(sx - half - postW / 2, sy - top, postW, top);
    ctx.fillRect(sx + half - postW / 2, sy - top, postW, top);
    const bx = sx - half, bw = half * 2, by = sy - top;
    let label;
    if (seg.gate === 'finish') {
        const cols = 16, cw = bw / cols;
        for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111';
            ctx.fillRect(bx + c * cw, by + r * bh / 2, cw + 1, bh / 2 + 1);
        }
        label = 'META';
    } else {
        ctx.fillStyle = seg.gate === 'start' ? '#1fae4b' : '#ffb800';
        ctx.fillRect(bx, by, bw, bh);
        label = seg.gate === 'start' ? 'SALIDA' : 'CHECKPOINT';
    }
    if (bh > 12) {
        ctx.font = 'bold ' + Math.floor(bh * 0.6) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, bh * 0.1);
        ctx.strokeStyle = '#000';
        ctx.strokeText(label, sx, by + bh * 0.72);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, sx, by + bh * 0.72);
        ctx.textAlign = 'left';
    }
}


// Objetos nuevos de los temas de la tercera entrega (los demás los dibuja drawObj)
function drawObjExt(o, x, y, k) {
    const s = o.size;
    switch (o.kind) {
        case 'cactus': {
            const h = 1700 * s * k, w = 380 * s * k;
            if (h < 3) return;
            ctx.fillStyle = '#3f8f46'; ctx.strokeStyle = '#1f4d27'; ctx.lineWidth = Math.max(1, w * 0.08);
            ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2, y - h + w / 2); ctx.arc(x, y - h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillRect(x - w * 1.5, y - h * 0.55, w * 1.0, w * 0.5); ctx.fillRect(x - w * 1.5, y - h * 0.82, w * 0.5, h * 0.27 + w * 0.5);
            ctx.fillRect(x + w * 0.5, y - h * 0.4, w * 1.0, w * 0.5); ctx.fillRect(x + w * 1.0, y - h * 0.62, w * 0.5, h * 0.22 + w * 0.5);
            break;
        }
        case 'mesa': {
            const h = 2600 * s * k, w = 3400 * s * k;
            if (h < 4) return;
            ctx.fillStyle = '#b5562f';
            ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w * 0.38, y - h * 0.85); ctx.lineTo(x - w * 0.3, y - h); ctx.lineTo(x + w * 0.28, y - h); ctx.lineTo(x + w * 0.4, y - h * 0.8); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
            for (let i = 1; i <= 3; i++) { ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,200,150,0.14)'; ctx.fillRect(x - w * 0.46, y - h * i / 3.4, w * 0.92, h / 7); }
            break;
        }
        case 'lamp': {
            const h = 1900 * k, w = Math.max(1.5, 90 * k);
            if (h < 5) return;
            const dir = o.offset > 0 ? -1 : 1;
            ctx.fillStyle = '#2a2d3a'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillRect(Math.min(x, x + dir * 420 * k), y - h, Math.abs(420 * k), w);
            const hx = x + dir * 420 * k;
            if (h > 12) {
                const g = ctx.createRadialGradient(hx, y - h, 1, hx, y - h, 650 * k);
                g.addColorStop(0, 'rgba(255,236,170,0.55)'); g.addColorStop(1, 'rgba(255,236,170,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, y - h, 650 * k, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = '#fff4c2'; ctx.fillRect(hx - w * 1.4, y - h - w * 0.3, w * 2.8, w * 1.2);
            break;
        }
        case 'bldg': {
            const w = 2600 * s * k, h = (3600 + 1800 * s) * k;
            if (h < 6) return;
            ctx.fillStyle = '#1a2036'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillStyle = '#10152a'; ctx.fillRect(x - w / 2, y - h, w * 0.08, h);
            const cell = Math.max(3, w * 0.2);
            for (let wy = y - h + cell * 0.6; wy < y - cell; wy += cell * 1.5) {
                for (let wx = x - w / 2 + cell * 0.6; wx < x + w / 2 - cell; wx += cell * 1.4) {
                    ctx.fillStyle = hash01(o.size * 1000 + wy * 0.13 + wx * 0.07) > 0.5 ? '#ffd98a' : '#2b3350';
                    ctx.fillRect(wx, wy, cell * 0.7, cell * 0.9);
                }
            }
            break;
        }
        case 'broadleaf': {
            const h = 1100 * s * k, w = 260 * s * k, R = 900 * s * k;
            if (R < 3) return;
            const lf = curTheme.leaf || ['#2e7d32', '#388e3c', '#43a047'];
            ctx.fillStyle = '#5a3b1e'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillStyle = lf[0]; ctx.beginPath(); ctx.arc(x - R * 0.55, y - h - R * 0.35, R * 0.75, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = lf[1]; ctx.beginPath(); ctx.arc(x + R * 0.55, y - h - R * 0.35, R * 0.75, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = lf[2]; ctx.beginPath(); ctx.arc(x, y - h - R * 0.85, R * 0.85, 0, Math.PI * 2); ctx.fill();
            break;
        }
        default:
            drawObj(o, x, y, k);
    }
}

// Un segmento completo, de lejos a cerca: ruta, estructuras, puertas, objetos, rivales y arcos
function drawEntry(e, rl) {
    const seg = e.seg, a = seg.p1.screen, b = seg.p2.screen;
    if (b.y < a.y) {   // los tramos "de espaldas" (bajada oculta) no se dibujan
        drawRoadSegment(seg, e.fog);
        if (seg.tunnel) drawTunnelShell(seg, e.fog);
        if (seg.bridge) drawBridgeParts(seg);
    }
    if (seg.p1.camera.z < PLAYER_Z * 0.6) return;
    const sc = a.scale, k = sc * WIDTH / 2, alpha = clamp(1 - e.fog, 0.05, 1);
    if (seg.gate) { ctx.globalAlpha = alpha; drawGate(seg, k, a.x, a.y); ctx.globalAlpha = 1; }
    for (let j = 0; j < seg.objs.length; j++) {
        const o = seg.objs[j];
        if (o.down) continue;
        const sx = a.x + sc * o.offset * ROAD_W * WIDTH / 2;
        if (sx < -700 || sx > WIDTH + 700) continue;
        ctx.globalAlpha = alpha;
        drawObjExt(o, sx, a.y, k);
        ctx.globalAlpha = 1;
    }
    if (rl) for (let j = 0; j < rl.length; j++) drawRival(rl[j], seg, alpha);
    if (seg.arch) drawArch(seg, alpha);
}

function renderWorld() {
    const segs = stage.segs, N = stage.N, TL = stage.TL, circ = stage.mode === 'circuit';
    const pos = circ ? wrapZ(position) : position;                  // z de la cámara dentro de la vuelta
    const baseIdx = clamp(Math.floor(pos / SEG_LEN), 0, N - 1);
    const base = segs[baseIdx];
    const basePercent = (pos % SEG_LEN) / SEG_LEN;
    const pzL = circ ? wrapZ(position + PLAYER_Z) : position + PLAYER_Z;
    const pSeg = segs[clamp(Math.floor(pzL / SEG_LEN), 0, N - 1)];
    const pPct = (pzL % SEG_LEN) / SEG_LEN;
    const playerY = pSeg.p1.world.y + (pSeg.p2.world.y - pSeg.p1.world.y) * pPct;

    let shakeX = 0, shakeY = 0;
    if (gameState === 'RUNNING' && speed > 20) {
        const rough = SURFACES[pSeg.surface].noiseG * 6 + (Math.abs(playerX) > 1.08 && !pSeg.tunnel && !pSeg.bridge ? 1.2 : 0.2);
        const amt = (speed / VEHICLES[selVeh].top) * rough * 60;
        shakeX = (Math.random() - 0.5) * amt; shakeY = (Math.random() - 0.5) * amt;
    }
    const camX = playerX * ROAD_W + shakeX;
    const camY = playerY + CAM_H + shakeY;

    drawBackground();

    // 1) proyección de cerca a lejos (acumula el desplazamiento lateral de las curvas)
    let x = 0, dx = -(base.curve * basePercent);
    entries.length = 0;
    for (let n = 0; n < DRAW_DIST; n++) {
        let idx = baseIdx + n, camZ = pos;
        if (idx >= N) { if (!circ) break; idx -= N; camZ = pos - TL; }
        const seg = segs[idx];
        project(seg.p1, camX - x, camY, camZ);
        project(seg.p2, camX - x - dx, camY, camZ);
        x += dx; dx += seg.curve;
        if (seg.p1.camera.z <= CAM_DEPTH) continue;
        entries.push({ seg: seg, fog: 1 - 1 / Math.exp(Math.pow(n / DRAW_DIST, 2) * (seg.tunnel ? 3.6 : curTheme.fogD)) });
    }

    // rivales agrupados por segmento (solo los que están dentro de la distancia de dibujo)
    const rivalBy = {}, pzT = position + PLAYER_Z;
    const drawList = ghostCar ? rivals.concat([ghostCar]) : rivals;
    for (let i = 0; i < drawList.length; i++) {
        const r = drawList[i], d = r.z - pzT;
        if (d < -PLAYER_Z * 0.6 - 200 || d > (DRAW_DIST - 2) * SEG_LEN) continue;
        const ri = circ ? Math.floor(wrapZ(r.z) / SEG_LEN) % N : clamp(Math.floor(r.z / SEG_LEN), 0, N - 1);
        (rivalBy[ri] = rivalBy[ri] || []).push(r);
    }

    // 2) dibujo de lejos a cerca
    for (let i = entries.length - 1; i >= 0; i--) drawEntry(entries[i], rivalBy[entries[i].seg.index]);
    return { shakeX: shakeX, shakeY: shakeY };
}

// Dentro de un túnel: oscurece la escena y suma el haz de los faros
function drawTunnelLight() {
    const seg = stage.segs[segIndexAt(position + PLAYER_Z)];
    if (!seg || !seg.tunnel) return;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.66, 10, WIDTH / 2, HEIGHT * 0.66, 280);
    g.addColorStop(0, 'rgba(255,244,200,0.38)'); g.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = 'source-over';
}

function fitDims(img, boxW, boxH) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return { w: boxW, h: boxH };
    const ba = boxW / boxH, ia = img.naturalWidth / img.naturalHeight;
    return ia > ba ? { w: boxW, h: boxW / ia } : { w: boxH * ia, h: boxH };
}

function drawPlayerCar(shake) {
    const cW = 300, cH = 205;
    const bounce = (gameState === 'RUNNING' && speed > 5) ? Math.sin(stageTime * 16) * (speed / VEHICLES[selVeh].top) * 2.4 : 0;
    const lean = clamp(steerInput * 0.08 + vx * 0.02, -0.14, 0.14);
    const cX = WIDTH / 2 - cW / 2 + steerInput * 30 + shake.shakeX;
    const cY = HEIGHT - cH - 14 + shake.shakeY + bounce;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(WIDTH / 2 + steerInput * 30, HEIGHT - 16, cW * 0.42, 9, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(cX + cW / 2, cY + cH);
    ctx.rotate(lean);
    ctx.translate(-(cX + cW / 2), -(cY + cH));
    const img = carImgs[selVeh];
    if (img && img.complete && img.naturalWidth !== 0) {
        const d = fitDims(img, cW, cH);
        ctx.drawImage(img, cX + (cW - d.w) / 2, cY + (cH - d.h), d.w, d.h);
    } else {
        const col = ['#ff2a00', '#0066ff', '#ccaa00'][selVeh];
        ctx.fillStyle = '#0f0f14'; ctx.fillRect(cX + 6, cY + cH - 35, 24, 35); ctx.fillRect(cX + cW - 30, cY + cH - 35, 24, 35);
        ctx.fillStyle = col; ctx.fillRect(cX, cY + 25, cW, cH - 40);
        ctx.fillStyle = '#14161f'; ctx.fillRect(cX + 16, cY + 35, cW - 32, 25);
        ctx.fillStyle = keys.down ? '#ff1111' : '#660000'; ctx.fillRect(cX + 8, cY + cH - 28, 22, 10); ctx.fillRect(cX + cW - 30, cY + cH - 28, 22, 10);
    }
    ctx.restore();
}

function drawParticles(shake) {
    for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.65;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x + shake.shakeX, p.y + shake.shakeY, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawSnowfall() {
    if (!curTheme.snowfall || gameState === 'START') return;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const moving = gameState !== 'PAUSED';
    const wind = -bgX * 0.0; // el viento no depende de la curva para no marear
    for (const f of flakes) {
        if (moving) {
            f.y += f.s * STEP * (1 + speed / 260);
            f.x += Math.sin(f.y * 0.03 + f.r) * 0.4 - speed * 0.004 + wind;
            if (f.y > HEIGHT) { f.y = -4; f.x = Math.random() * WIDTH; }
            if (f.x < -4) f.x += WIDTH + 8;
        }
        ctx.fillRect(f.x, f.y, f.r, f.r);
    }
}

// ---- Minimapa (también se usa en el menú) ----


// ---- Minimapa: la geometría real de la pista; túneles en naranja y puentes en celeste ----
function drawMini(c, x, y, size, stg, playerSeg, riv) {
    c.fillStyle = 'rgba(8, 14, 26, 0.85)';
    c.fillRect(x, y, size, size);
    c.strokeStyle = ACCENT; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, size - 2, size - 2);
    const pad = 12, span = size - pad * 2;
    const ox = x + pad + span * (1 - stg.mini.w) / 2, oy = y + pad + span * (1 - stg.mini.h) / 2;
    const pts = stg.mini.pts, feat = stg.mini.feat, n = pts.length;
    const P = function (i) { return [ox + pts[i % n].x * span, oy + pts[i % n].y * span]; };
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 3;
    c.beginPath();
    for (let i = 0; i < n; i++) { const p = P(i); if (i === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]); }
    if (stg.mini.closed) c.closePath();
    c.stroke();
    // estructuras: tramos marcados con color
    for (let kind = 1; kind <= 2; kind++) {
        c.strokeStyle = kind === 1 ? '#ff9f1a' : '#4fc3f7'; c.lineWidth = 4.5;
        let i = 0;
        while (i < n) {
            if (feat[i] === kind) {
                let j = i;
                c.beginPath(); const p0 = P(i > 0 ? i - 1 : i); c.moveTo(p0[0], p0[1]);
                while (j < n && feat[j] === kind) { const p = P(j); c.lineTo(p[0], p[1]); j++; }
                c.stroke();
                i = j;
            } else i++;
        }
    }
    const s0 = P(0);
    c.fillStyle = '#1fae4b';
    c.beginPath(); c.arc(s0[0], s0[1], 3.5, 0, Math.PI * 2); c.fill();
    if (!stg.mini.closed) {
        const e0 = P(n - 1);
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(e0[0], e0[1], 3.5, 0, Math.PI * 2); c.fill();
    }
    if (riv) {
        for (let i = 0; i < riv.length; i++) {
            const zl = stg.mode === 'circuit' ? ((riv[i].z % stg.TL) + stg.TL) % stg.TL : riv[i].z;
            const ri = clamp(Math.floor(zl / SEG_LEN / 6), 0, n - 1), p = P(ri);
            c.fillStyle = riv[i].ghost ? '#ffffff' : RIVAL_COLORS[riv[i].veh]; c.strokeStyle = '#000'; c.lineWidth = 1;
            c.beginPath(); c.arc(p[0], p[1], 3.2, 0, Math.PI * 2); c.fill(); c.stroke();
        }
    }
    if (playerSeg >= 0) {
        const p = P(clamp(Math.floor(playerSeg / 6), 0, n - 1));
        c.fillStyle = ACCENT; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(p[0], p[1], 5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
}

// ---- HUD ----
function txt(str, x, y, size, color, align, bold) {
    ctx.font = (bold === false ? '' : 'bold ') + size + 'px monospace';
    ctx.fillStyle = color; ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
}
function arrow(cx, cy, dir, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + dir * s, cy); ctx.lineTo(cx - dir * s * 0.6, cy - s * 0.9); ctx.lineTo(cx - dir * s * 0.6, cy + s * 0.9);
    ctx.closePath(); ctx.fill();
}


function drawPacenotes() {
    const rows = upcomingNotes(3, 450);
    if (!rows.length) return;
    const px = WIDTH / 2 - 105, py = 10, rh = 27;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px, py, 210, rows.length * rh + 6);
    rows.forEach(function (r, i) {
        const y = py + 3 + i * rh + rh / 2, n = r.n;
        ctx.globalAlpha = i === 0 ? 1 : 0.65;
        if (n.kind === 'tunnel' || n.kind === 'bridge') {
            const col = n.kind === 'tunnel' ? '#ff9f1a' : '#4fc3f7';
            ctx.strokeStyle = col; ctx.lineWidth = 3;
            ctx.beginPath();
            if (n.kind === 'tunnel') { ctx.moveTo(px + 11, y + 8); ctx.lineTo(px + 11, y - 1); ctx.arc(px + 20, y - 1, 9, Math.PI, 0); ctx.lineTo(px + 29, y + 8); }
            else { ctx.moveTo(px + 9, y + 3); ctx.quadraticCurveTo(px + 20, y - 9, px + 31, y + 3); ctx.moveTo(px + 9, y + 7); ctx.lineTo(px + 31, y + 7); }
            ctx.stroke();
            txt(n.kind === 'tunnel' ? 'TÚNEL' : 'PUENTE', px + 48, y + 6, 16, col);
        } else {
            const g = n.grade;
            const col = g <= 2 ? '#ff5252' : g <= 4 ? '#ffb800' : '#6bff8a';
            arrow(px + 20, y, n.dir === 'R' ? 1 : -1, 9, col);
            txt(String(g), px + 48, y + 8, 22, col);
            const tag = (n.hairpin ? 'HORQ ' : '') + (n.long ? 'LARGA' : '');
            if (tag) txt(tag, px + 72, y + 5, 12, '#ffffff');
        }
        txt(Math.round(r.m / 10) * 10 + 'm', px + 200, y + 6, 16, '#ffffff', 'right');
        ctx.globalAlpha = 1;
    });
}

function drawHUD() {
    if (gameState === 'START') return;
    const veh = VEHICLES[selVeh];
    const circ = stage.mode === 'circuit';
    const seg = stage.segs[segIndexAt(position + PLAYER_Z)];

    // Paneles de fondo para que el HUD se lea sobre cualquier paisaje
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(10, 8, 198, 144);
    ctx.fillRect(10, HEIGHT - 124, 160, 116);

    txt((comp && comp.tt ? 'CRONO   ' : (circ ? 'CARRERA ' : 'ETAPA   ')) + formatTime(stageTime), 20, 30, 20, '#ffffff');
    if (comp && comp.tt) txt(ghostRec ? 'RÉC ' + formatTime(ghostRec.time) : 'SIN RÉCORD', 20, 55, 20, ACCENT);
    else txt('LÍMITE ' + Math.ceil(Math.max(0, timeLeft)) + ' s', 20, 55, 20, timeLeft < 10 ? '#ff4d4d' : ACCENT);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, 66, 120, 6);
    ctx.fillStyle = damage > 66 ? '#ff4d4d' : damage > 33 ? '#ffb800' : '#6bff8a';
    ctx.fillRect(20, 66, 120 * damage / 100, 6);
    txt('DAÑO ' + Math.round(damage) + '%', 20, 90, 13, '#c8d2e0', 'left', false);
    if (rivals.length) {
        const rk = currentRank();
        txt('POSICIÓN P' + rk + '/' + (rivals.length + 1), 20, 118, 17, rk === 1 ? '#6bff8a' : '#ffffff');
    } else if (comp && comp.tt) {
        const gd = ghostDelta();
        if (gd == null) txt('SIN SOMBRA', 20, 118, 17, '#c8d2e0');
        else txt('SOMBRA ' + (gd > 0 ? '+' : '-') + Math.abs(gd).toFixed(2) + ' s', 20, 118, 17, gd > 0.005 ? '#ff6b6b' : '#6bff8a');
    }
    if (circ) {
        const lapCur = Math.min(lapNo + 1, stage.laps);
        txt('VUELTA ' + lapCur + '/' + stage.laps + '  ' + formatTime(stageTime - lapStartTime), 20, 142, 14, '#ffffff');
    } else {
        const pct = Math.round(clamp((position + PLAYER_Z) / (stage.finishSeg * SEG_LEN), 0, 1) * 100);
        txt(pct + '% DE LA ETAPA', 20, 142, 14, '#ffffff');
    }

    // Minimapa + datos de la prueba
    drawMini(ctx, WIDTH - 112, 12, 100, stage, seg.index, ghostCar ? rivals.concat([ghostCar]) : rivals);
    ctx.fillStyle = 'rgba(8,14,26,0.85)';
    ctx.fillRect(WIDTH - 112, 112, 100, 38);
    if (circ) txt('VUELTA ' + Math.min(lapNo + 1, stage.laps) + '/' + stage.laps, WIDTH - 62, 129, 14, '#ffffff', 'center');
    else txt(Math.max(0, (stage.finishSeg * SEG_LEN - (position + PLAYER_Z)) * M_PER_UNIT / 1000).toFixed(1) + ' km', WIDTH - 62, 129, 14, '#ffffff', 'center');
    txt((comp && comp.order.length > 1 ? (comp.k + 1) + '/' + comp.order.length + ' ' : '') + SHORT_NAMES[stageIdx].toUpperCase(), WIDTH - 62, 144, 9, '#c8d2e0', 'center', false);

    if (gameState !== 'COUNTDOWN') drawPacenotes();

    // Velocímetro
    txt(String(Math.floor(speed)), 20, HEIGHT - 30, 44, '#ffffff');
    txt('KM/H', 112, HEIGHT - 32, 14, '#9fb0c8', 'left', false);
    const sLabel = seg.tunnel ? 'TÚNEL' : seg.bridge ? 'PUENTE' : SURFACES[seg.surface].name;
    txt(sLabel, 20, HEIGHT - 104, 15, seg.tunnel ? '#ff9f1a' : seg.bridge ? '#4fc3f7' : ACCENT);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, HEIGHT - 22, 130, 7);
    ctx.fillStyle = rpm > veh.rpmMax * 0.9 ? '#ff4d4d' : ACCENT;
    ctx.fillRect(20, HEIGHT - 22, 130 * clamp(rpm / veh.rpmMax, 0, 1), 7);
    txt('MARCHA ' + gear, 20, HEIGHT - 84, 15, '#c8d2e0', 'left', false);

    // Barra de progreso (con checkpoints en etapas y vueltas en circuitos)
    const bx = 250, bw = 300, by = HEIGHT - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx, by, bw, 4);
    const prog = clamp((position + PLAYER_Z) / raceGoal(), 0, 1);
    ctx.fillStyle = ACCENT; ctx.fillRect(bx, by, bw * prog, 4);
    ctx.fillStyle = '#ffffff';
    if (circ) { for (let l = 1; l < stage.laps; l++) ctx.fillRect(bx + bw * l / stage.laps - 1, by - 3, 2, 10); }
    else stage.cps.forEach(function (c) { ctx.fillRect(bx + bw * c / stage.finishSeg - 1, by - 3, 2, 10); });

    // Cuenta regresiva y avisos
    if (gameState === 'COUNTDOWN') {
        const num = Math.ceil(countdown - 0.6);
        if (num >= 1) txt(String(num), WIDTH / 2, HEIGHT / 2 - 40, 90, ACCENT, 'center');
    }
    if (popup.t > 0) {
        txt(popup.text, WIDTH / 2, HEIGHT / 2 - 60, 40, '#ffffff', 'center');
        if (popup.sub) txt(popup.sub, WIDTH / 2, HEIGHT / 2 - 24, 28, ACCENT, 'center');
    }
    if (gameState === 'PAUSED') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
        txt('PAUSA', WIDTH / 2, HEIGHT / 2, 52, ACCENT, 'center');
        txt('P / Esc: continuar  ·  M: música  ·  C: copiloto', WIDTH / 2, HEIGHT / 2 + 34, 15, '#ffffff', 'center', false);
    }
}

function renderFrame() {
    if (!stage) return;
    ctx.imageSmoothingEnabled = false;
    const shake = renderWorld();
    drawTunnelLight();
    drawParticles(shake);
    if (gameState !== 'START') drawPlayerCar(shake);
    drawSnowfall();
    if (crashFlash > 0) {
        ctx.fillStyle = 'rgba(255, 30, 0, ' + ((crashFlash / 0.35) * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    drawHUD();
}

// ---------------------------------------------------------------------------
// LOOP PRINCIPAL (pasos fijos con acumulador: igual en cualquier navegador)
// ---------------------------------------------------------------------------
let _last = null, _acc = 0;
const MAX_STEPS = 5;
function masterLoop(now) {
    if (_last === null) _last = now;
    let d = (now - _last) / 1000;
    _last = now;
    if (d > 0.25) d = 0.25;
    _acc += d;
    let steps = 0;
    while (_acc >= STEP && steps < MAX_STEPS) { updatePhysics(STEP); _acc -= STEP; steps++; }
    renderFrame();
    requestAnimationFrame(masterLoop);
}

window.onload = function () {
    initInput();
    populateEvents();
    updateMenu();
    requestAnimationFrame(masterLoop);
};


