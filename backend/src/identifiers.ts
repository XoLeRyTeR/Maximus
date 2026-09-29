export type Identifier = {
  value: string;
  kind: 'inn' | 'ogrn';
  entityType: 'company' | 'entrepreneur';
};

export type IdentifierResult =
  | { status: 'missing' }
  | { status: 'multiple' }
  | { status: 'invalid' }
  | { status: 'valid'; identifier: Identifier };

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  return (sum % 11) % 10;
}

export function isValidIdentifier(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;

  if (value.length === 10) {
    return checkDigit(value, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(value[9]);
  }
  if (value.length === 12) {
    const first = checkDigit(value, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
    const second = checkDigit(value, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
    return first === Number(value[10]) && second === Number(value[11]);
  }
  if (value.length === 13) {
    return Number(BigInt(value.slice(0, 12)) % 11n % 10n) === Number(value[12]);
  }
  if (value.length === 15) {
    return Number(BigInt(value.slice(0, 14)) % 13n % 10n) === Number(value[14]);
  }
  return false;
}

export function extractIdentifier(text: string): IdentifierResult {
  const candidates = [...new Set(text.match(/(?<!\d)(?:\d{15}|\d{13}|\d{12}|\d{10})(?!\d)/g) ?? [])];
  if (candidates.length === 0) return { status: 'missing' };
  if (candidates.length > 1) return { status: 'multiple' };

  const value = candidates[0];
  if (!isValidIdentifier(value)) return { status: 'invalid' };

  return {
    status: 'valid',
    identifier: {
      value,
      kind: value.length === 10 || value.length === 12 ? 'inn' : 'ogrn',
      entityType: value.length === 10 || value.length === 13 ? 'company' : 'entrepreneur',
    },
  };
}
