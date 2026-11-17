/* Authored screen coordinates keep annotations deterministic under timeline seeking.
   Original app controls stay underneath; this layer never captures pointer input. */
(()=>{
const screen=document.querySelector('#screen');
const layer=document.createElement('div');layer.className='phone-coach';layer.id='phone-coach';
layer.innerHTML=`<svg class="coach-ink" viewBox="0 0 390 846" aria-hidden="true"><path class="coach-arrow-back" id="coach-arrow-back"/><path class="coach-arrow" id="coach-arrow" pathLength="1"/><path class="coach-arrow" id="coach-arrowhead"/><path class="coach-sparks" id="coach-sparks"/></svg><div class="coach-ring" id="coach-ring" aria-hidden="true"></div><aside class="coach-card" data-layout-allow-occlusion id="coach-card" aria-label="Demo annotation"><img class="coach-crow" src="assets/crow.svg" alt=""><div class="coach-kicker"><span class="coach-step" id="coach-step" data-layout-allow-overlap></span><span id="coach-topic" data-layout-allow-overlap></span></div><strong class="coach-title" data-layout-allow-overlap id="coach-title"></strong><p class="coach-copy" data-layout-allow-overlap id="coach-copy"></p></aside>`;
screen.appendChild(layer);
const q=id=>document.getElementById(id),card=q('coach-card'),ring=q('coach-ring');
const ease=x=>{x=Math.min(1,Math.max(0,x));return 1-Math.pow(1-x,3)};
const pop=gsap.parseEase('back.out(1.7)');
const cues=[
 {start:.15,end:4.15,step:'01',topic:'FIND YOUR CREW',title:'Where’s our crew?',copy:'One tap brings everyone back into view.',top:457,target:[10,692,191,43],arrow:[305,552,306,666,205,706]},
 {start:4.15,end:8.2,step:'02',topic:'THE NEXT MEET-UP',title:'Next hello, sorted.',copy:'The where and when, together in one place.',top:50,target:[14,180,362,151],arrow:[315,146,365,153,366,179]},
 {start:8.2,end:12.4,step:'03',topic:'UNDERSTAND THE ETA',title:'An ETA, with the why.',copy:'Tap to see how the arrival window is estimated.',top:50,target:[14,608,362,88],arrow:[347,148,381,390,370,609]},
 {start:12.4,end:14.2,step:'04',topic:'CONFIRM THE MEET-UP',title:'Met here? Tap. Done.',copy:'Mark the hello, then move the plan along.',top:50,target:[14,291,362,50],arrow:[315,146,370,205,366,290]},
 {start:14.2,end:15.3,step:'04',topic:'THE PLAN MOVES ON',title:'Hello, next stop!',copy:'The next meet-up changes for the whole crew.',top:457,target:[198,109,169,104],arrow:[326,453,385,334,367,216]},
 {start:15.3,end:17.5,step:'04',topic:'A LITTLE UNDO MAGIC',title:'Oops? Undo’s got you.',copy:'One tap restores the previous meet-up.',top:50,target:[14,370,95,41],arrow:[70,145,26,260,25,369]},
 {start:17.5,end:20.8,step:'05',topic:'FIND A PIT STOP',title:'Pit stop, anyone?',copy:'Find toilets, parking, coffee and charging.',top:50,target:[14,297,362,42],arrow:[319,147,376,228,364,297]},
 {start:20.8,end:24.2,step:'05',topic:'PICK WHAT YOU NEED',title:'Need a charge?',copy:'Tap EV. The list narrows to charging stops.',top:50,target:[229,297,76,42],arrow:[270,147,320,222,285,296]},
 {start:24.2,end:28.2,step:'06',topic:'CHECK IN ON YOUR RUNNER',title:'How’s Emily doing?',copy:'Her route pace and arrival estimate, together.',top:50,target:[14,270,362,160],arrow:[317,147,373,201,365,270]},
 {start:28.2,end:31.4,step:'07',topic:'OPEN THE CREW TOOLBOX',title:'More than a moving dot.',copy:'Meet the crew. Browse the miles. Replay a cheer.',top:50,target:[14,235,362,295],arrow:[315,147,372,186,367,235]},
 {start:31.4,end:34,step:'07',topic:'MOMENTS & MILESTONES',title:'Little steps. Big moments.',copy:'Open a saved milestone for a little lift.',top:50,target:[14,559,362,152],arrow:[347,147,382,374,370,559]},
 {start:34,end:38,step:'08',topic:'CHEERS WORTH KEEPING',title:'Big miles. Bigger cheers!',copy:'Personal celebrations, saved to replay.',top:718,target:[23,177,344,507],arrow:[90,714,62,699,66,684]},
 {start:38,end:40,step:'08',topic:'REPLAY THE GOOD BITS',title:'Keep the good bits.',copy:'That lovely moment is still there for later.',top:50,target:[14,559,362,152],arrow:[347,147,382,374,370,559]},
 {start:40.5,end:45.3,step:'09',topic:'A FRIENDLY LOOK AT THE FIELD',title:'“Not competitive”…',copy:'Browse a recorded snapshot by race category.',top:50,target:[14,403,362,240],arrow:[347,147,380,284,370,403]},
 {start:45.3,end:47.7,step:'09',topic:'SAVE YOUR FAVOURITES',title:'Pick your favourites.',copy:'Tap Follow to keep a runner close.',top:50,target:[287,694,78,35],arrow:[347,147,382,430,369,694]},
 {start:47.7,end:50.5,step:'09',topic:'LOOK ACROSS THE FIELD',title:'How about everyone?',copy:'An informal comparison across race categories.',top:50,target:[14,750.8,362,63],arrow:[347,147,382,458,370,750.8]},
 {start:50.5,end:54.2,step:'10',topic:'LOCATION SHARING IS OPT-IN',title:'Sharing is your choice.',copy:'A crew role never switches on phone GPS.',top:50,target:[14,270,362,127],arrow:[317,147,373,201,365,270]},
 {start:54.2,end:56,step:'10',topic:'POCKET CREW',title:'Your crew. In your pocket.',copy:'More time cheering. Less time coordinating.',top:457,target:null,arrow:null}
];
function draw(s,t,manual){
 const cue=cues.find(c=>t>=c.start&&t<c.end);
 const active=!manual&&Boolean(cue);
 // Opaque narration cards cover secondary chrome while the target stays clear.
 const posterReturn=screen.querySelector('#poster-modal .primary');
 posterReturn.style.visibility=active&&s.poster?'hidden':'visible';
 if(active&&s.toast&&cue.top===50)screen.querySelector('#toast').style.opacity=0;
 if(!active){for(const node of screen.querySelectorAll('.point-pin>*'))node.removeAttribute('data-layout-allow-occlusion');layer.style.visibility='hidden';return}layer.style.visibility='visible';
 const age=t-cue.start,remaining=cue.end-t,opacity=Math.min(ease(age/.16),ease(remaining/.12));
 layer.style.opacity=opacity;
 card.style.top=cue.top+'px';card.style.transform=`translateY(${(1-ease(age/.28))*13}px) scale(${.82+.18*pop(Math.min(1,age/.36))}) rotate(${-1.0*(1-ease(age/.45))}deg)`;
 q('coach-step').textContent=cue.step;q('coach-topic').textContent=cue.topic;q('coach-title').textContent=cue.title;q('coach-copy').textContent=cue.copy;
 let target=cue.target?.slice(),arrow=cue.arrow?.slice();
 // The existing app's state transitions and scroll offsets, in screen pixels.
 if(cue.start===4.15&&t<4.8){card.style.top='457px';target=[198,109,169,104];arrow=[326,453,385,334,367,216]}
 if(cue.start===8.2&&t<8.5){target=[14,638,362,88];arrow=[347,148,381,400,370,638]}
 if(cue.start===15.3&&t>=16.4){card.style.top='457px';target=[198,109,169,104];arrow=[326,453,385,334,367,216]}
 if(cue.start===17.5&&t<18){card.style.top='457px';target=[134,758,122,64];arrow=[190,552,254,657,237,756]}
 if(cue.start===40.5&&t<42){card.style.top='457px';target=[254,758,117,64];arrow=[292,552,334,659,322,757]}
 if(cue.start===47.7){const scroll=Math.min(105,165*(t<48?0:t>=48.45?1:(()=>{let x=(t-48)/.45;return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2})()));target[1]-=scroll;arrow[5]-=scroll}
 if(cue.start===24.2&&t<25){card.style.top='457px';target=[138,313,70,88];arrow=[112,453,104,411,139,368]}
 if(cue.start===28.2&&t<29){card.style.top='457px';target=[276,42,105,48];arrow=[330,453,386,250,370,92]}
 if(cue.start===50.5&&t<51){target=[174,428,73,93];arrow=[300,147,315,330,246,432]}
 // This CLI version reads occlusion intent on individual text participants.
 for(const node of screen.querySelectorAll('.point-pin>*')){
  node.toggleAttribute('data-layout-allow-occlusion',parseFloat(card.style.top)===457&&s.pane==='map');
 }
 // During sheet travel, let the panel arrive before outlining its contents.
 const moving=s.pane!=='map'&&t-s.openAt<.5;
 ring.style.display=target&&!moving?'block':'none';
 if(target){const [x,y,w,h]=target;ring.style.left=x+'px';ring.style.top=y+'px';ring.style.width=w+'px';ring.style.height=h+'px';const pulse=age<.95?Math.sin(age/.95*Math.PI*4)*.026*(1-age/.95):0;ring.style.transform=`scale(${1+pulse})`;
 const sparks=`M${x-4},${y-8} l-5,-8 M${x+8},${y-10} l1,-9 M${x+w+5},${y-4} l8,-5`;
 q('coach-sparks').setAttribute('d',sparks);q('coach-sparks').style.opacity=!moving&&age<1?Math.sin(Math.min(1,age)*Math.PI):0;}
 else q('coach-sparks').style.opacity=0;
 const showArrow=arrow&&!moving;
 for(const id of ['coach-arrow','coach-arrow-back','coach-arrowhead'])q(id).style.opacity=showArrow?1:0;
 if(showArrow){const [x,y,cx,cy,ex,ey]=arrow,d=`M${x},${y} Q${cx},${cy} ${ex},${ey}`;q('coach-arrow').setAttribute('d',d);q('coach-arrow-back').setAttribute('d',d);const a=Math.atan2(ey-cy,ex-cx),len=11,spread=.55;
 q('coach-arrowhead').setAttribute('d',`M${ex-len*Math.cos(a-spread)},${ey-len*Math.sin(a-spread)} L${ex},${ey} L${ex-len*Math.cos(a+spread)},${ey-len*Math.sin(a+spread)}`);
 const reveal=ease((age-.13)/.38);q('coach-arrow').style.strokeDasharray='1';q('coach-arrow').style.strokeDashoffset=1-reveal;q('coach-arrow-back').style.opacity=reveal;q('coach-arrowhead').style.opacity=reveal>.95?1:0;
 }
}
window.PhoneCoach={draw,hide:()=>layer.style.visibility='hidden'};
})();
