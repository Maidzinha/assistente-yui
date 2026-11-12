/**
 * Reproduz o "JSON canônico" do Maidzinha License Manager
 * (Python: json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)).
 *
 * Os números são mantidos exatamente como vieram no texto da resposta: o Python escreve
 * 30.0 e o JSON.parse do JavaScript transformaria em 30, quebrando a assinatura.
 */

class RawNumber {
  constructor(readonly literal: string) {}
}

type Value = null | boolean | string | RawNumber | Value[] | { [k: string]: Value }

function parse(text: string): Value {
  let i = 0
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const fail = (): never => {
    throw new Error('Resposta do servidor de licenças não é um JSON válido.')
  }
  const value = (): Value => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const obj: Record<string, Value> = {}
      ws()
      if (text[i] === '}') { i++; return obj }
      for (;;) {
        ws()
        if (text[i] !== '"') fail()
        const k = str()
        ws()
        if (text[i++] !== ':') fail()
        obj[k] = value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return obj }
        fail()
      }
    }
    if (c === '[') {
      i++
      const arr: Value[] = []
      ws()
      if (text[i] === ']') { i++; return arr }
      for (;;) {
        arr.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return arr }
        fail()
      }
    }
    if (c === '"') return str()
    if (text.startsWith('true', i)) { i += 4; return true }
    if (text.startsWith('false', i)) { i += 5; return false }
    if (text.startsWith('null', i)) { i += 4; return null }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64))
    if (!m) fail()
    i += m![0].length
    return new RawNumber(m![0])
  }
  const str = (): string => {
    const start = i
    i++
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) fail()
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const out = value()
  ws()
  if (i !== text.length) fail()
  return out
}

function stringify(v: Value): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return JSON.stringify(v)
  if (v instanceof RawNumber) return v.literal
  if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`
  const keys = Object.keys(v).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(v[k])}`).join(',')}}`
}

/**
 * Recebe o texto bruto da resposta e devolve a assinatura enviada e o JSON canônico
 * de todo o resto (que é o que o servidor assinou).
 */
export function canonicalWithoutSignature(raw: string): { signature: string | null; canonical: string } {
  const root = parse(raw)
  if (!root || typeof root !== 'object' || Array.isArray(root) || root instanceof RawNumber) {
    return { signature: null, canonical: '' }
  }
  const { signature, ...rest } = root as Record<string, Value>
  return { signature: typeof signature === 'string' ? signature : null, canonical: stringify(rest) }
}
