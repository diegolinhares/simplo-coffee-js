import currency from "currency.js"

const BRL = { symbol: "R$ ", separator: ".", decimal: "," }

export function fromCents(cents: number): currency {
  return currency(cents, { ...BRL, fromCents: true })
}
