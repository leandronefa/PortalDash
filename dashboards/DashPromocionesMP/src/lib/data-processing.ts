import { parse, ParseResult } from "papaparse";
import { parse as parseDate, isValid } from "date-fns";

export interface Venta {
  FECHA: string;
  suc: string;
  NUMERO: string;
  cod_cond: string;
  nombre_cond: string;
  fecha_ini: string;
  fecha_fin: string;
  descuento: number;
  preciolleno: number;
  TotalTk: number;
  IMPORTE: number;
  cod_MP: string;
  nom_MP: string;
  CUOTA: number;
  // Parsed real date
  parsedDate: Date | null;
}

export interface Tesi {
  date_created: string;
  transaction_amount: number;
  mercadopago_fee: number;
  net_received_amount: number;
  cuotas: number;
  payment_type: string;
  description: string;
  financing_fee: number;
  sub_unit: string;
  franchise: string;
  issuer_name: string;
  // Parsed real date
  parsedDate: Date | null;
}

export interface CrossMatch extends Venta {
  tesiMatch: Tesi | null;
}

export function parseVentas(csv: string): Promise<Venta[]> {
  return new Promise((resolve) => {
    parse<any>(csv, {
      header: true,
      delimiter: ";",
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data.map((row) => {
          let pDate = null;
          try {
            // Old format: "Sun May 10 2026 09:47:37 GMT-0300 (hora estándar de Argentina)" → strip parenthesized part
            // New format: "2026-05-09 20:29:38" → replace space with T for reliable ISO parse
            let cleaned = (row.FECHA ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(cleaned)) {
              cleaned = cleaned.replace(' ', 'T') + 'Z'; // treat as UTC, same as SQL Server stores it
            }
            const d = new Date(cleaned);
            if (isValid(d)) pDate = d;
          } catch (e) {}

          return {
            FECHA: row.FECHA,
            suc: row.suc,
            NUMERO: row.NUMERO,
            cod_cond: row.COD_COND ?? row.cod_cond,
            nombre_cond: row.NOMBRE_COND ?? row.nombre_cond,
            fecha_ini: row.fecha_ini,
            fecha_fin: row.fecha_fin,
            descuento: parseFloat(row.DESCUENTO ?? row.descuento) || 0,
            preciolleno: parseFloat(row.PRECIOLLENO ?? row.preciolleno) || 0,
            TotalTk: parseFloat(row.TotalTk) || 0,
            IMPORTE: parseFloat(row.IMPORTE) || 0,
            cod_MP: row.cod_MP,
            nom_MP: row.nom_MP,
            CUOTA: parseInt(row.CUOTA, 10) || 1,
            parsedDate: pDate,
          };
        });
        resolve(data);
      },
    });
  });
}

// Strip BOM from CSV string
function stripBOM(csv: string): string {
  return csv.replace(/^\uFEFF/, '');
}

export function parseTesi(csv: string): Promise<Tesi[]> {
  return new Promise((resolve) => {
    parse<any>(stripBOM(csv), {
      header: true,
      delimiter: ";",
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data.map((row) => {
          let pDate = null;
          try {
            // New format: ISO 8601 "2026-05-10T21:05:17.000-03:00"
            // Old format: "06/05/2026 21:51:21"
            const raw: string = row.TRANSACTION_DATE ?? row.date_created ?? '';
            const d = new Date(raw);
            if (isValid(d)) {
              pDate = d;
            } else {
              // fallback: try date-fns for old format
              pDate = parseDate(raw, "d/M/yyyy H:mm:ss", new Date());
              if (!isValid(pDate)) pDate = parseDate(raw, "d/M/yyyy H:mm", new Date());
            }
          } catch (e) {}

          // New format uses uppercase field names; fall back to old lowercase names
          return {
            date_created: row.TRANSACTION_DATE ?? row.date_created,
            transaction_amount: parseFloat(row.TRANSACTION_AMOUNT ?? row.transaction_amount) || 0,
            mercadopago_fee: parseFloat(row.FEE_AMOUNT ?? row.mercadopago_fee) || 0,
            net_received_amount: parseFloat(row.REAL_AMOUNT ?? row.net_received_amount) || 0,
            cuotas: parseInt(row.INSTALLMENTS ?? row.installments ?? row.cuotas, 10) || 1,
            payment_type: row.PAYMENT_METHOD_TYPE ?? row.payment_type,
            description: row.STORE_NAME ?? row.description,
            financing_fee: parseFloat(row.FINANCING_FEE_AMOUNT ?? row.financing_fee) || 0,
            sub_unit: row.SUB_UNIT ?? row.sub_unit,
            franchise: row.FRANCHISE ?? row.franchise,
            issuer_name: row.ISSUER_NAME ?? row.issuer_name,
            parsedDate: pDate,
          };
        });
        resolve(data);
      },
    });
  });
}

export function crossData(ventas: Venta[], tesi: Tesi[]): CrossMatch[] {
  // Only target "555" and "M" (and "ME", which is also M...)
  // The user said: "para el medio de pago codigo 555 y M".
  const validMPCodes = ["555", "M", "ME"]; 
  
  // Create a copy of tesi to track matched
  const tesiAvailable = [...tesi];

  return ventas.map((v) => {
    let match: Tesi | null = null;
    
    // Check if it's the target MP
    if (v.cod_MP && validMPCodes.includes(v.cod_MP)) {
        const vSuc = parseInt(v.suc, 10);
        
        // Find best match in tesiAvailable
        const matchIndex = tesiAvailable.findIndex((t) => {
            // Match Sucursal
            let tSuc = -1;
            if (t.description && t.description.startsWith("Suc.")) {
                tSuc = parseInt(t.description.replace("Suc.", ""), 10);
            }
            if (vSuc !== tSuc) return false;
            
            // Match Importe (allow up to 1 peso delta)
            if (Math.abs(v.IMPORTE - t.transaction_amount) > 1) return false;

            // If dates are available, require they are on the same calendar day
            // (avoid matching same-amount transactions from different days)
            if (v.parsedDate && t.parsedDate) {
                const vDay = v.parsedDate.toDateString();
                const tDay = t.parsedDate.toDateString();
                if (vDay !== tDay) return false;
            }

            return true;
        });

        if (matchIndex !== -1) {
            match = tesiAvailable[matchIndex];
            // Remove the matched element to avoid double matching
            tesiAvailable.splice(matchIndex, 1);
        }
    }

    return {
      ...v,
      tesiMatch: match,
    };
  });
}

export function aggregateSalesByPromo(ventas: Venta[]) {
    const agg: Record<string, { promo: string; ventas: number; descuentos: number; importe: number }> = {};
    ventas.forEach(v => {
        if (!v.nombre_cond) return;
        const key = v.nombre_cond;
        if (!agg[key]) agg[key] = { promo: key, ventas: 0, descuentos: 0, importe: 0 };
        agg[key].ventas += 1;
        agg[key].descuentos += v.descuento;
        agg[key].importe += v.preciolleno;
    });
    return Object.values(agg).sort((a,b) => b.importe - a.importe);
}

export function aggregateSalesByPaymentMethod(ventas: Venta[]) {
    const agg: Record<string, { mp: string; ventas: number; descuentos: number; importe: number }> = {};
    ventas.forEach(v => {
        if (!v.nom_MP) return;
        const key = v.nom_MP;
        if (!agg[key]) agg[key] = { mp: key, ventas: 0, descuentos: 0, importe: 0 };
        agg[key].ventas += 1;
        agg[key].descuentos += v.descuento;
        agg[key].importe += v.preciolleno;
    });
    return Object.values(agg).sort((a,b) => b.importe - a.importe);
}

export function getPromoByPaymentMethod(ventas: Venta[]) {
    // Array of { paymentMethod, promotions: [{ promoName, ventas, importe, descuentos, cuotasDistribution }] }
    const res: Record<string, Record<string, { promoName: string, ventas: number, importe: number, descuentos: number, cuotasDest: Record<string, number> }>> = {};
    
    ventas.forEach(v => {
        if (!v.nom_MP || !v.nombre_cond) return;
        const mp = v.nom_MP;
        const p = v.nombre_cond;
        if (!res[mp]) res[mp] = {};
        if (!res[mp][p]) {
            res[mp][p] = {
                promoName: p,
                ventas: 0,
                importe: 0,
                descuentos: 0,
                cuotasDest: {}
            };
        }
        res[mp][p].ventas += 1;
        res[mp][p].importe += v.preciolleno;
        res[mp][p].descuentos += v.descuento;
        
        const cuotaKey = v.CUOTA.toString();
        res[mp][p].cuotasDest[cuotaKey] = (res[mp][p].cuotasDest[cuotaKey] || 0) + 1;
    });
    
    // Format for easier display
    return Object.keys(res).map(mp => {
        return {
            paymentMethod: mp,
            promotions: Object.values(res[mp]).sort((a,b) => b.importe - a.importe).map(promo => {
                return {
                    ...promo,
                    avgCuotas: Object.keys(promo.cuotasDest).reduce((acc, k) => acc + (parseInt(k)*promo.cuotasDest[k]), 0) / promo.ventas,
                    cuotasSummary: Object.keys(promo.cuotasDest).map(k => `${k}c: ${promo.cuotasDest[k]}`).join(', ')
                };
            })
        };
    });
}

const TARGET_MP_DETAIL = ["555", "M", "ME"];

export interface TesiBreakdown {
    payment_type: string;
    issuer_name: string;
    cuotas: number;
    count: number;
    importe: number;
    ventaImporte: number;
    descuento: number;
}

export interface PromoPaymentMethod {
    mpCode: string;
    mpName: string;
    count: number;
    importe: number;
    descuento: number;
    tesiBreakdown: TesiBreakdown[]; // populated only for M / 555 / ME
    ventaCuotasBreakdown: { cuotas: number; count: number; importe: number; descuento: number }[]; // from SP for non-MP
}

export interface PromoFullDetail {
    promoName: string;
    totalVentas: number;
    totalImporte: number;
    totalDescuento: number;
    totalTickets: number;
    paymentMethods: PromoPaymentMethod[];
}

export function getPromoFullDetail(crossMatched: CrossMatch[]): PromoFullDetail[] {
    const res: Record<string, {
        totalVentas: number;
        totalImporte: number;
        totalDescuento: number;
        numerosSet: Set<string>;
        methods: Record<string, {
            mpCode: string; mpName: string;
            count: number; importe: number; descuento: number;
            tesiAgg: Record<string, TesiBreakdown>;
            cuotaAgg: Record<number, { cuotas: number; count: number; importe: number; descuento: number }>;
        }>;
    }> = {};

    crossMatched.forEach(c => {
        if (!c.nombre_cond) return;
        const promo = c.nombre_cond;
        if (!res[promo]) res[promo] = { totalVentas: 0, totalImporte: 0, totalDescuento: 0, numerosSet: new Set(), methods: {} };

        res[promo].totalVentas += 1;
        res[promo].totalImporte += c.preciolleno;
        res[promo].totalDescuento += c.descuento;
        if (c.NUMERO) res[promo].numerosSet.add(c.NUMERO);

        const mpCode = c.cod_MP || '';
        const mpName = c.nom_MP || mpCode;
        if (!res[promo].methods[mpCode]) {
            res[promo].methods[mpCode] = { mpCode, mpName, count: 0, importe: 0, descuento: 0, tesiAgg: {}, cuotaAgg: {} };
        }
        res[promo].methods[mpCode].count += 1;
        res[promo].methods[mpCode].importe += c.preciolleno;
        res[promo].methods[mpCode].descuento += c.descuento;

        // For non-MP methods, aggregate cuotas from the venta itself
        if (!TARGET_MP_DETAIL.includes(mpCode)) {
            const cuota = c.CUOTA || 1;
            if (!res[promo].methods[mpCode].cuotaAgg[cuota]) {
                res[promo].methods[mpCode].cuotaAgg[cuota] = { cuotas: cuota, count: 0, importe: 0, descuento: 0 };
            }
            res[promo].methods[mpCode].cuotaAgg[cuota].count += 1;
            res[promo].methods[mpCode].cuotaAgg[cuota].importe += c.preciolleno;
            res[promo].methods[mpCode].cuotaAgg[cuota].descuento += c.descuento;
        }

        if (TARGET_MP_DETAIL.includes(mpCode) && c.tesiMatch) {
            const pt = c.tesiMatch.payment_type || 'N/A';
            const issuer = c.tesiMatch.issuer_name || 'N/A';
            const cuotas = c.tesiMatch.cuotas;
            const tKey = `${pt}|${issuer}|${cuotas}`;
            if (!res[promo].methods[mpCode].tesiAgg[tKey]) {
                res[promo].methods[mpCode].tesiAgg[tKey] = { payment_type: pt, issuer_name: issuer, cuotas, count: 0, importe: 0, ventaImporte: 0, descuento: 0 };
            }
            res[promo].methods[mpCode].tesiAgg[tKey].count += 1;
            res[promo].methods[mpCode].tesiAgg[tKey].importe += c.tesiMatch.transaction_amount;
            res[promo].methods[mpCode].tesiAgg[tKey].ventaImporte += c.preciolleno;
            res[promo].methods[mpCode].tesiAgg[tKey].descuento += c.descuento;
        }
    });

    return Object.entries(res)
        .map(([promoName, data]) => ({
            promoName,
            totalVentas: data.totalVentas,
            totalImporte: data.totalImporte,
            totalDescuento: data.totalDescuento,
            totalTickets: data.numerosSet.size,
            paymentMethods: Object.values(data.methods)
                .sort((a, b) => b.importe - a.importe)
                .map(m => ({
                    mpCode: m.mpCode,
                    mpName: m.mpName,
                    count: m.count,
                    importe: m.importe,
                    descuento: m.descuento,
                    tesiBreakdown: Object.values(m.tesiAgg).sort((a, b) => b.count - a.count),
                    ventaCuotasBreakdown: Object.values(m.cuotaAgg).sort((a, b) => a.cuotas - b.cuotas),
                })),
        }))
        .sort((a, b) => b.totalImporte - a.totalImporte);
}

// ── Cuotas para medios NO-MercadoPago ─────────────────────────────────────────
const MP_CODES = ['555', 'M', 'ME'];

export interface CuotaRow {
    cuotas: number;
    ventas: number;
    importe: number;
    descuento: number;
}

export interface NonMPCuotas {
    cod_MP: string;
    nom_MP: string;
    totalVentas: number;
    totalImporte: number;
    totalDescuento: number;
    cuotasBreakdown: CuotaRow[];
}

export function aggregateCuotasByNonMP(ventas: Venta[]): NonMPCuotas[] {
    const agg: Record<string, Omit<NonMPCuotas, 'cuotasBreakdown'> & { cuotas: Record<number, CuotaRow> }> = {};
    ventas.forEach(v => {
        if (!v.cod_MP || MP_CODES.includes(v.cod_MP)) return;
        const key = v.cod_MP;
        if (!agg[key]) agg[key] = {
            cod_MP: v.cod_MP,
            nom_MP: v.nom_MP || v.cod_MP,
            totalVentas: 0,
            totalImporte: 0,
            totalDescuento: 0,
            cuotas: {},
        };
        agg[key].totalVentas += 1;
        agg[key].totalImporte += v.IMPORTE;
        agg[key].totalDescuento += v.descuento;
        const c = v.CUOTA || 1;
        if (!agg[key].cuotas[c]) agg[key].cuotas[c] = { cuotas: c, ventas: 0, importe: 0, descuento: 0 };
        agg[key].cuotas[c].ventas += 1;
        agg[key].cuotas[c].importe += v.IMPORTE;
        agg[key].cuotas[c].descuento += v.descuento;
    });
    return Object.values(agg)
        .sort((a, b) => b.totalImporte - a.totalImporte)
        .map(({ cuotas, ...rest }) => ({
            ...rest,
            cuotasBreakdown: Object.values(cuotas).sort((a, b) => a.cuotas - b.cuotas),
        }));
}
