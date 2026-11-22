const british: Record<string, string> = {
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring', colorful: 'colourful',
  favorite: 'favourite', favorites: 'favourites', honor: 'honour', behavior: 'behaviour',
  neighbor: 'neighbour', neighbors: 'neighbours', neighborhood: 'neighbourhood', humor: 'humour',
  flavor: 'flavour', flavors: 'flavours', theater: 'theatre', theaters: 'theatres', center: 'centre',
  centers: 'centres', gray: 'grey', jewelry: 'jewellery', pajamas: 'pyjamas', catalog: 'catalogue',
  canceled: 'cancelled', canceling: 'cancelling', traveling: 'travelling', traveler: 'traveller',
  traveled: 'travelled', modeled: 'modelled', modeling: 'modelling', organize: 'organise',
  organized: 'organised', organizing: 'organising', recognize: 'recognise', recognized: 'recognised',
  realize: 'realise', realized: 'realised', apologize: 'apologise', apologized: 'apologised',
};

export function britishSpelling(text: string): string {
  return text.replace(/\b[a-z]+\b/gi, word => {
    const lower = word.toLowerCase();
    const replacement = Object.hasOwn(british, lower) ? british[lower] : undefined;
    if (!replacement) return word;
    if (word === word.toUpperCase()) return replacement.toUpperCase();
    return word[0] === word[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}

