import { Npc } from '@/dto/index.js';

interface NpcCardProps {
    npc: Npc;
}

export const NpcCard = ({npc: _npc}: NpcCardProps) => (
    <div>
        <div>Header</div>
        <div>Metadata</div>
        <div>Description+bio</div>
    </div>
);
