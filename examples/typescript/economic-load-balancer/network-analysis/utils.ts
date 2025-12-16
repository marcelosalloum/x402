/**
 * Fetches live cryptocurrency price from Coinbase Pro API
 * @param symbol - Cryptocurrency symbol (e.g., "ETH", "XLM")
 * @returns Current price in USD
 * @throws Error if price cannot be fetched (NO FALLBACKS - LIVE DATA ONLY)
 */
export async function getCryptoPrice(symbol: string): Promise<number> {
  const response = await fetch(
    `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${symbol} price: HTTP ${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as {
    data: { amount: string };
  };

  const price = parseFloat(json.data.amount);

  if (isNaN(price) || price <= 0) {
    throw new Error(
      `Invalid price returned for ${symbol}: ${json.data.amount}`
    );
  }

  return price;
}
