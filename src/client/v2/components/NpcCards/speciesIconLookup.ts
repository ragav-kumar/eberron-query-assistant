import dragonbornIcon from '@/client/v2/assets/icons/dragonborn.webp';
import dwarfIcon from '@/client/v2/assets/icons/dwarf.webp';
import elfIcon from '@/client/v2/assets/icons/elf.webp';
import gnomeIcon from '@/client/v2/assets/icons/gnome.webp';
import goliathIcon from '@/client/v2/assets/icons/goliath.webp';
import halflingIcon from '@/client/v2/assets/icons/halfling.webp';
import humanIcon from '@/client/v2/assets/icons/human.webp';
import orcIcon from '@/client/v2/assets/icons/orc.webp';
import shifterIcon from '@/client/v2/assets/icons/shifter.jpeg';
import tieflingIcon from '@/client/v2/assets/icons/tiefling.webp';
import warforgedIcon from '@/client/v2/assets/icons/warforged.jpeg';

interface SpeciesIconDefinition {
    aliases?: readonly string[];
    key: string;
    src: string;
}

const speciesIconDefinitions: readonly SpeciesIconDefinition[] = [
    {key: 'dragonborn', src: dragonbornIcon},
    {key: 'dwarf', src: dwarfIcon},
    {key: 'elf', src: elfIcon, aliases: ['half elf', 'half-elf', 'khoravar']},
    {key: 'gnome', src: gnomeIcon},
    {key: 'goliath', src: goliathIcon},
    {key: 'halfling', src: halflingIcon},
    {key: 'human', src: humanIcon},
    {key: 'orc', src: orcIcon, aliases: ['half orc', 'half-orc']},
    {key: 'shifter', src: shifterIcon},
    {key: 'tiefling', src: tieflingIcon},
    {key: 'warforged', src: warforgedIcon},
] as const;

const canonicalSpeciesIconMap: Record<string, string> = {};

for (const {aliases = [], key, src} of speciesIconDefinitions) {
    canonicalSpeciesIconMap[key] = src;
    for (const alias of aliases) {
        canonicalSpeciesIconMap[alias] = src;
    }
}

const normalizeSpeciesKey = (species: string) => species
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const getSpeciesIcon = (species?: string) => {
    if (!species) {
        return null;
    }

    return canonicalSpeciesIconMap[normalizeSpeciesKey(species)] ?? null;
};
