import catalog from '../shared/characters.json';
export type Character = { id: string; name: string; family: string; generation: number; url: string; preview: string };
export const characters: Character[] = catalog;
export const getCharacter = (id?: string): Character => characters.find(character => character.id === id) || characters[0];
