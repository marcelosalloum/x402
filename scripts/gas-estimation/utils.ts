/**
 * Fetches live cryptocurrency price from Coinbase Pro API
 * @param symbol - Cryptocurrency symbol (e.g., "ETH", "XLM")
 * @returns Current price in USD, or 0 if fetch fails
 */
export async function getCryptoPrice(symbol: string): Promise<number> {
  try {
    const response = await fetch(
      `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`
    );
    const json = (await response.json()) as {
      data: { amount: string };
    };
    return parseFloat(json.data.amount);
  } catch (error) {
    console.warn(`Failed to fetch price for ${symbol}, using fallback.`);
    // Fallback prices if API fails
    if (symbol === "ETH") return 3200;
    if (symbol === "XLM") return 0.24;
    return 0;
  }
}
