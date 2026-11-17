/** Extract just race check-ins and crew roles; never archive supporter coordinates. */
import {readFile,writeFile} from 'node:fs/promises';
const file=process.argv[2];
if(!file)throw new Error('Pass a saved public crew JSON response');
const {room}=JSON.parse(await readFile(file,'utf8'));
if(!room?.checkpointStatuses||!room?.achievements?.records)throw new Error('Race history is missing');
const history={
 checkpointStatuses:room.checkpointStatuses,
 achievements:room.achievements,
 releases:room.releases,
 supporterPlans:Object.fromEntries(Object.entries(room.supporterPlans||{}).map(([person,plan])=>[person,{mode:plan.mode,updatedAt:plan.updatedAt}]))
};
await writeFile(new URL('../archive/emily-crew-history-2026.json',import.meta.url),JSON.stringify(history));
console.log('Archived race check-ins and roles, excluding supporter GPS coordinates');
