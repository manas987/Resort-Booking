/**
 * The three supplied fixtures (Docs/Product.md, "Original sample data"), verbatim — byte for
 * byte, never reworded to ease classification. `publicRef` is a literal, not generated
 * (Docs/04-contracts.md explicitly says the generator must never reproduce these).
 */
export const SUPPLIED_ENQUIRIES = [
  {
    publicRef: 'ENQ-4410',
    message: "Venue for my sister's wedding in Feb 2027, about 250 guests, 2 nights",
    expectedCategory: 'wedding' as const,
  },
  {
    publicRef: 'ENQ-4411',
    message: 'Is a villa free 14-16 Nov for 2 adults and a child?',
    expectedCategory: 'room' as const,
  },
  {
    publicRef: 'ENQ-4412',
    message: 'Team of 45 wants a January offsite with a conference hall',
    expectedCategory: 'offsite' as const,
  },
];
