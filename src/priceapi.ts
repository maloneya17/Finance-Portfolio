/**
 * Phase 5E — Live asset price fetching.
 * Supports CoinGecko (crypto, no key) and Alpha Vantage (stocks, user key).
 * All functions return null on failure rather than throwing.
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ALPHA_BASE     = 'https://www.alphavantage.co/query';

// Cache: ticker → { price, ts } — avoids hammering APIs on every re-render
const _cache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Known CoinGecko IDs for common crypto tickers
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin', DOT: 'polkadot',
  AVAX: 'avalanche-2', MATIC: 'matic-network', LINK: 'chainlink',
  LTC: 'litecoin', BCH: 'bitcoin-cash', UNI: 'uniswap',
  XLM: 'stellar', ATOM: 'cosmos', FIL: 'filecoin', TRX: 'tron',
  NEAR: 'near', ALGO: 'algorand', ICP: 'internet-computer',
  SHIB: 'shiba-inu', APE: 'apecoin', SAND: 'the-sandbox',
};

function isCryptoTicker(ticker: string): boolean {
  return ticker.toUpperCase() in COINGECKO_IDS;
}

/** Fetch current price from CoinGecko (no API key required). */
async function fetchCryptoPrice(ticker: string, currency: string): Promise<number | null> {
  const id  = COINGECKO_IDS[ticker.toUpperCase()];
  if (!id) return null;
  const cur = currency.toLowerCase();
  // Map common symbols to currency codes
  const curCode = cur === '£' ? 'gbp' : cur === '$' ? 'usd' : cur === '€' ? 'eur' : cur;
  const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(curCode)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, Record<string, number>>;
    const price = data[id]?.[curCode];
    return typeof price === 'number' && isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

/** Fetch current price from Alpha Vantage (stocks/ETFs, requires free API key). */
async function fetchStockPrice(ticker: string, apiKey: string): Promise<number | null> {
  if (!apiKey) return null;
  const url = `${ALPHA_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json() as { 'Global Quote'?: { '05. price'?: string } };
    const priceStr = data['Global Quote']?.['05. price'];
    const price = parseFloat(priceStr ?? '');
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the current price for a given ticker symbol.
 * Tries CoinGecko for crypto; Alpha Vantage for everything else.
 * Returns null if fetch fails or no key is provided for stocks.
 * Uses a 5-minute in-memory cache to avoid repeated requests.
 */
export async function fetchAssetPrice(
  ticker: string,
  currency: string,
  alphaVantageKey: string,
): Promise<number | null> {
  const key   = `${ticker.toUpperCase()}:${currency}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.price;

  const price = isCryptoTicker(ticker)
    ? await fetchCryptoPrice(ticker, currency)
    : await fetchStockPrice(ticker, alphaVantageKey);

  if (price !== null) _cache.set(key, { price, ts: Date.now() });
  return price;
}

/** Clear the price cache (e.g. after user changes currency). */
export function clearPriceCache(): void {
  _cache.clear();
}

/** Returns true if the ticker is a known crypto symbol. */
export function isKnownCrypto(ticker: string): boolean {
  return isCryptoTicker(ticker);
}
