import catalog from '../shared/characters.json';
import sourceCatalog from '../shared/character-sources.json';

export type Character = { id: string; name: string; family: string; sourceId?: string; generation: number; url: string; preview: string };
export type CharacterSource = { id: string; name: string; url: string };
export const characters: Character[] = catalog;
export const characterSources: CharacterSource[] = sourceCatalog;
export const getCharacter = (id?: string): Character => characters.find(character => character.id === id) || characters[0];
const unknownSource: CharacterSource = {
  id: 'unknown',
  name: '未登记来源',
  url: 'https://github.com/Synchronized2/Mira-Companion/blob/main/THIRD_PARTY_NOTICES.md',
};
export const getCharacterSource = (character: Character): CharacterSource => {
  return characterSources.find(source => source.id === character.sourceId) || unknownSource;
};
