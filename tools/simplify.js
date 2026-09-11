/**
 * Упрощение countries.geojson алгоритмом Рамера — Дугласа — Пейкера.
 *
 * Запуск из корня репозитория:
 *   node tools/simplify.js
 *
 * Если установлен @turf/simplify, скрипт использует его.
 * Иначе работает встроенная реализация DP.
 *
 * Результат: countries.simplified.geojson (цель 1,5–2 МБ).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'countries.geojson');
const OUTPUT = path.join(ROOT, 'countries.simplified.geojson');
const TARGET_MIN = 1.5 * 1024 * 1024;
const TARGET_MAX = 2.2 * 1024 * 1024;

function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function roundCoord(value) {
  return Math.round(value * 10000) / 10000;
}

function simplifyLine(line, epsilon) {
  if (!Array.isArray(line) || line.length < 2) return line;
  const isRing = line.length > 2 &&
    line[0][0] === line[line.length - 1][0] &&
    line[0][1] === line[line.length - 1][1];
  const simplified = rdp(line, epsilon).map((pt) => [roundCoord(pt[0]), roundCoord(pt[1])]);
  if (isRing) {
    if (simplified.length < 4) return line.map((pt) => [roundCoord(pt[0]), roundCoord(pt[1])]);
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push([first[0], first[1]]);
    }
  }
  return simplified;
}

function simplifyCoords(coords, type, epsilon) {
  if (type === 'Polygon') {
    return coords.map((ring) => simplifyLine(ring, epsilon));
  }
  if (type === 'MultiPolygon') {
    return coords.map((polygon) => polygon.map((ring) => simplifyLine(ring, epsilon)));
  }
  if (type === 'LineString') {
    return simplifyLine(coords, epsilon);
  }
  if (type === 'MultiLineString') {
    return coords.map((line) => simplifyLine(line, epsilon));
  }
  return coords;
}

function simplifyWithBuiltin(geojson, epsilon) {
  return {
    type: 'FeatureCollection',
    features: geojson.features.map((feature) => {
      if (!feature.geometry) return feature;
      return {
        type: 'Feature',
        properties: feature.properties,
        geometry: {
          type: feature.geometry.type,
          coordinates: simplifyCoords(
            feature.geometry.coordinates,
            feature.geometry.type,
            epsilon
          )
        }
      };
    })
  };
}

function tryTurfSimplify(geojson, epsilon) {
  let turfSimplify;
  try {
    turfSimplify = require('@turf/simplify');
  } catch (err) {
    return null;
  }
  return turfSimplify(geojson, { tolerance: epsilon, highQuality: false, mutate: false });
}

function serialize(geojson) {
  return JSON.stringify(geojson);
}

function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error('Не найден countries.geojson рядом со скриптом.');
  }
  const geojson = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const epsilons = [0.03, 0.045, 0.06, 0.08, 0.1];
  let best = null;

  for (const epsilon of epsilons) {
    const simplified = tryTurfSimplify(geojson, epsilon) || simplifyWithBuiltin(geojson, epsilon);
    const text = serialize(simplified);
    const size = Buffer.byteLength(text);
    if (!best || Math.abs(size - 1.8 * 1024 * 1024) < Math.abs(best.size - 1.8 * 1024 * 1024)) {
      best = { text, size, epsilon };
    }
    if (size >= TARGET_MIN && size <= TARGET_MAX) {
      best = { text, size, epsilon };
      break;
    }
  }

  fs.writeFileSync(OUTPUT, best.text);
  const mb = (best.size / (1024 * 1024)).toFixed(2);
  process.stdout.write(
    `Записан ${path.basename(OUTPUT)}: ${mb} МБ (epsilon=${best.epsilon})\n`
  );
}

main();
