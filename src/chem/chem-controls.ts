import type ChemELNPlugin from '../main';
import { openInsertChemModal } from './chem-markdown';

export function registerChemInsertionControls(plugin: ChemELNPlugin): void {
    plugin.addCommand({
        id: 'insert-chem-structure',
        name: '插入 Ketcher 化学看板',
        callback: () => openInsertChemModal(plugin, 'reaction'),
    });

    plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu) => {
        menu.addSeparator();
        menu.addItem((item) => item
            .setTitle('插入 Ketcher 化学看板')
            .setIcon('flask-conical')
            .setSection('scholarium-chem')
            .onClick(() => openInsertChemModal(plugin, 'reaction')));
    }));
}
