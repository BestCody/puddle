const events = [
  { id:'neon', title:'Neon Garden', category:'Nightlife', date:'Fri · 10:00 PM', place:'Stackt Market · 2.4 km', price:'$24', image:'/events/neon-night.svg', description:'A glowing indoor garden, live DJs and surreal installations until late.', friends:['/avatars/ava.svg','/avatars/maya.svg','/avatars/kai.svg'], match:'98% your vibe' },
  { id:'clay', title:'Clay & Cabernet', category:'Workshop', date:'Sat · 6:30 PM', place:'Dundas West · 3.1 km', price:'$38', image:'/events/ceramics.svg', description:'Make a wonky cup, drink something good and meet people who also need a hobby.', friends:['/avatars/jules.svg','/avatars/maya.svg'], match:'Creative pick' },
  { id:'roof', title:'Rooftop Cinema Club', category:'Film', date:'Sun · 8:45 PM', place:'King West · 1.8 km', price:'$18', image:'/events/rooftop.svg', description:'Cult classics, city lights, popcorn and blankets above the skyline.', friends:['/avatars/kai.svg','/avatars/ava.svg'], match:'Because you saved film' },
  { id:'jazz', title:'Late Night Jazz Club', category:'Live music', date:'Thu · 9:00 PM', place:'The Annex · 4.2 km', price:'$16', image:'/events/jazz.svg', description:'A tiny room, warm lights and three sets from Toronto’s newest jazz players.', friends:['/avatars/maya.svg','/avatars/jules.svg'], match:'92% your vibe' },
  { id:'run', title:'Sunset Run & Gelato', category:'Wellness', date:'Tue · 7:15 PM', place:'Harbourfront · 5.0 km', price:'Free', image:'/events/sunset-run.svg', description:'A casual 5K with no pace pressure, ending with gelato by the lake.', friends:['/avatars/ava.svg','/avatars/kai.svg','/avatars/jules.svg'], match:'Friends are going' },
  { id:'market', title:'Indie Makers After Dark', category:'Market', date:'Fri · 7:00 PM', place:'Parkdale · 4.8 km', price:'$8', image:'/events/indie-market.svg', description:'Zines, ceramics, prints, vintage finds and a tiny DJ booth in the back.', friends:['/avatars/maya.svg','/avatars/jules.svg'], match:'New near you' }
]

const state = { heroIndex:0, heroHistory:[], demoIndex:0, demoHistory:[], currentView:'discover', interested:new Set(['neon','jazz','market']) }
const $ = (selector, root=document) => root.querySelector(selector)
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)]

function eventCard(event, index, context='hero') {
  const friends = event.friends.map(src => `<img src="${src}" alt="">`).join('')
  return `<article class="event-card" data-event-id="${event.id}" data-context="${context}" style="z-index:${20-index}" tabindex="${index===0?0:-1}" aria-label="${event.title}, ${event.date}">
    <div class="event-card__image"><img src="${event.image}" alt="${event.title} event artwork" draggable="false"><div class="event-card__badges"><span class="badge">${event.category}</span><span class="badge">${event.match}</span></div><span class="swipe-label swipe-label--yes">I'm in</span><span class="swipe-label swipe-label--no">Maybe not</span></div>
    <div class="event-card__body"><div class="event-card__meta"><span>${event.date}</span><span>• ${event.place.split('·')[1]?.trim() || 'nearby'}</span></div><h3>${event.title}</h3><p>${event.description}</p><div class="event-card__footer"><div class="event-card__friends">${friends}<span>${event.friends.length} friends interested</span></div><span class="event-card__price">${event.price}</span></div></div>
  </article>`
}

function renderDeck(container, startIndex, context='hero') {
  if (!container) return
  const ordered = [...events.slice(startIndex), ...events.slice(0,startIndex)].slice(0,3)
  container.innerHTML = ordered.reverse().map((event,index,arr)=>eventCard(event,arr.length-1-index,context)).join('')
  const top = container.lastElementChild
  if (top) attachDrag(top, container, context)
}

function attachDrag(card, container, context) {
  let startX=0, currentX=0, dragging=false
  const yes = $('.swipe-label--yes',card), no = $('.swipe-label--no',card)
  card.addEventListener('pointerdown', event => { dragging=true; startX=event.clientX; card.setPointerCapture(event.pointerId); card.style.transition='none' })
  card.addEventListener('pointermove', event => {
    if(!dragging) return
    currentX=event.clientX-startX
    card.style.transform=`translateX(${currentX}px) rotate(${currentX/18}deg)`
    const alpha=Math.min(Math.abs(currentX)/100,1)
    yes.style.opacity=currentX>0?alpha:0; no.style.opacity=currentX<0?alpha:0
  })
  card.addEventListener('pointerup', () => {
    if(!dragging) return
    dragging=false; card.style.transition=''
    if(Math.abs(currentX)>85) completeSwipe(context,currentX>0?'right':'left',card)
    else {card.style.transform='';yes.style.opacity=0;no.style.opacity=0}
    currentX=0
  })
  card.addEventListener('keydown', event => {
    if(event.key==='ArrowLeft'){event.preventDefault();completeSwipe(context,'left',card)}
    if(event.key==='ArrowRight'){event.preventDefault();completeSwipe(context,'right',card)}
  })
}

function completeSwipe(context, direction, card) {
  if (!card) return
  const indexKey=context==='hero'?'heroIndex':'demoIndex'
  const historyKey=context==='hero'?'heroHistory':'demoHistory'
  const event=events[state[indexKey]%events.length]
  state[historyKey].push(state[indexKey])
  if(direction==='right') { state.interested.add(event.id); toast(`Saved ${event.title} to your plans ♥`); confetti() }
  else toast(`${event.title} skipped — showing something different`)
  const x=direction==='right'?window.innerWidth:-window.innerWidth
  card.style.transform=`translateX(${x}px) rotate(${direction==='right'?22:-22}deg)`;card.style.opacity='0'
  setTimeout(()=>{state[indexKey]=(state[indexKey]+1)%events.length;renderDeck(context==='hero'?$('#hero-deck'):$('#demo-deck'),state[indexKey],context)},280)
}

function undo(context='hero') {
  const indexKey=context==='hero'?'heroIndex':'demoIndex'
  const historyKey=context==='hero'?'heroHistory':'demoHistory'
  const previous=state[historyKey].pop()
  if(previous===undefined){toast('Nothing to undo yet');return}
  state[indexKey]=previous
  renderDeck(context==='hero'?$('#hero-deck'):$('#demo-deck'),state[indexKey],context)
  toast('Last swipe restored ↶')
}

function toast(message) {
  const region=$('#toast-region'); if(!region) return
  const item=document.createElement('div');item.className='toast';item.textContent=message;region.appendChild(item)
  setTimeout(()=>item.remove(),3200)
}

function confetti() {
  const layer=$('#confetti-layer'); if(!layer) return
  const colors=['#ff4fa3','#7c4dff','#ffd86b','#72e6c1','#65b8ff']
  for(let i=0;i<28;i++){
    const bit=document.createElement('i');bit.className='confetti';bit.style.left=`${35+Math.random()*30}%`;bit.style.top=`${5+Math.random()*15}%`;bit.style.background=colors[i%colors.length];bit.style.animationDelay=`${Math.random()*.18}s`;bit.style.transform=`rotate(${Math.random()*180}deg)`;layer.appendChild(bit);setTimeout(()=>bit.remove(),1500)
  }
}

const appViews = {
  discover: () => `<div class="demo-grid"><section class="demo-deck-panel"><div class="demo-deck" id="demo-deck"></div><div class="deck-actions"><button class="round-action round-action--undo" data-demo-swipe="undo">↶</button><button class="round-action round-action--no" data-demo-swipe="left">×</button><button class="round-action round-action--yes" data-demo-swipe="right">♥</button><button class="round-action round-action--share" data-demo-share>↗</button></div></section><aside class="demo-side-panel"><div class="filter-row">${['Tonight','For you','Free','Music','Food','Art'].map((x,i)=>`<button class="filter-pill ${i===0?'active':''}">${x}</button>`).join('')}</div><article class="tonight-card"><div class="tonight-card__top"><strong>Your vibe tonight</strong><span>based on 34 swipes</span></div><div class="vibe-bars"><div class="vibe-bar">Live music <span><i style="--w:88%;--bar:#ff4fa3"></i></span><b>88%</b></div><div class="vibe-bar">Low-key <span><i style="--w:64%;--bar:#7c4dff"></i></span><b>64%</b></div><div class="vibe-bar">Under $25 <span><i style="--w:79%;--bar:#72e6c1"></i></span><b>79%</b></div></div></article><div class="friend-plan"><img src="/avatars/maya.svg" alt="Maya"><div><strong>Maya saved Rooftop Cinema</strong><span>Sunday · 8:45 PM</span></div><button data-join-plan>Join plan</button></div><div class="friend-plan"><img src="/avatars/kai.svg" alt="Kai"><div><strong>Kai is going to Neon Garden</strong><span>Friday · 10:00 PM</span></div><button data-join-plan>Join plan</button></div></aside></div>`,
  explore: () => `<div class="explore-grid"><div><div class="filter-row"><button class="filter-pill active">Near me</button><button class="filter-pill">Tonight</button><button class="filter-pill">This weekend</button><button class="filter-pill">Under $20</button></div><div class="explore-list">${events.map(event=>`<article class="explore-card"><img src="${event.image}" alt="${event.title}"><div><span class="eyebrow">${event.category} · ${event.price}</span><h3>${event.title}</h3><p>${event.date} · ${event.place}</p></div></article>`).join('')}</div></div><aside class="explore-map"><div class="mini-map"><span class="map-road map-road--a"></span><span class="map-road map-road--b"></span><span class="map-road map-road--c"></span>${events.map((_,i)=>`<i style="--x:${18+(i*13)%70}%;--y:${20+(i*19)%65}%;--c:${['#ff4fa3','#7c4dff','#ffd86b','#72e6c1'][i%4]}">${['♪','✦','☕','⚽'][i%4]}</i>`).join('')}<div class="map-card"><strong>42 things tonight</strong><span>within your 8 km radius</span></div></div></aside></div>`,
  plans: () => `<div class="plans-grid">${events.filter(e=>state.interested.has(e.id)).map(event=>`<article class="plan-card"><img src="${event.image}" alt="${event.title}"><div><span class="eyebrow">${event.category}</span><h3>${event.title}</h3><p>${event.date}<br>${event.place}</p><footer><span>Interested</span><button class="icon-button">•••</button></footer></div></article>`).join('')}</div>`,
  social: () => `<div class="social-demo"><section><div class="organizer-top"><div><span>People at your events</span><h3>Meet your crowd.</h3></div></div><div class="match-grid">${[['maya','Maya, 20','indie films · matcha'],['kai','Kai, 22','photography · vinyl'],['jules','Jules, 21','music · climbing'],['ava','Noah, 23','food pop-ups · design']].map(([img,name,bio])=>`<article class="match-card"><img src="/avatars/${img}.svg" alt="${name}"><button aria-label="Like ${name}">♥</button><div><h3>${name}</h3><p>${bio}</p></div></article>`).join('')}</div></section><section><div class="organizer-top"><div><span>Event rooms</span><h3>Your group chats.</h3></div></div><div class="modal-list"><article><strong>Neon Garden crew · 46 online</strong><p>“Anyone meeting at Union before?”</p></article><article><strong>Clay & Cabernet · 18 online</strong><p>“Do they have non-alcoholic options?”</p></article><article><strong>Sunset Run · 32 online</strong><p>“Meet by the wave deck at 7!”</p></article></div></section></div>`,
  messages: () => `<div class="messages-demo"><aside class="conversation-list">${[['maya','Maya','See you Friday ✨'],['kai','Kai','Sending the ticket now'],['jules','Indie Night crew','46 people · 3 new']].map((x,i)=>`<button class="${i===0?'active':''}"><img src="/avatars/${x[0]}.svg" alt=""><span><strong>${x[1]}</strong><span>${x[2]}</span></span></button>`).join('')}</aside><section class="message-pane"><header><img src="/avatars/maya.svg" alt="Maya"><div><strong>Maya</strong><span>online now</span></div></header><div class="message-thread" id="demo-message-thread"><div class="message-bubble">Are we still meeting at Ossington at 7:30?</div><div class="message-bubble self">Yes! I’ll be by the north entrance ✨</div><div class="message-bubble">Perfect, see you there!</div></div><form class="message-compose" id="demo-message-form"><input placeholder="Message Maya…" aria-label="Message Maya"><button>↑</button></form></section></div>`,
  tickets: () => `<div class="ticket-wallet">${events.slice(0,2).map((event,i)=>`<article class="wallet-ticket"><img src="${event.image}" alt=""><div><span>${i?'SUN 02':'FRI 31'} · PUDDLE PASS</span><h3>${event.title}</h3><p>${event.date}<br>${event.place}</p><button data-ticket-code>Show QR code</button></div></article>`).join('')}</div>`
}

const viewMeta={discover:['Good evening, Ava','Find your next plan.'],explore:['42 events near Toronto','Explore your city.'],plans:['4 upcoming plans','Your calendar looks good.'],social:['Opted-in people only','Meet your crowd.'],messages:['3 unread messages','Keep the plan moving.'],tickets:['2 active tickets','You’re in.']}

function renderAppView(view) {
  state.currentView=view
  const area=$('#app-view'); if(!area) return
  area.innerHTML=appViews[view]?.() || appViews.discover()
  const [kicker,title]=viewMeta[view]||viewMeta.discover;$('#app-kicker').textContent=kicker;$('#app-title').textContent=title
  $$('[data-app-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.appView===view))
  if(view==='discover'){
    renderDeck($('#demo-deck'),state.demoIndex,'demo')
    $$('[data-demo-swipe]').forEach(btn=>btn.addEventListener('click',()=>btn.dataset.demoSwipe==='undo'?undo('demo'):completeSwipe('demo',btn.dataset.demoSwipe,$('#demo-deck').lastElementChild)))
    $('[data-demo-share]')?.addEventListener('click',()=>toast('Share link copied ↗'))
    $$('[data-join-plan]').forEach(btn=>btn.addEventListener('click',()=>{btn.textContent='Joined ✓';btn.disabled=true;toast('Added to your plans')}))
  }
  if(view==='messages') $('#demo-message-form')?.addEventListener('submit',event=>{event.preventDefault();const input=$('input',event.currentTarget);if(!input.value.trim())return;const bubble=document.createElement('div');bubble.className='message-bubble self';bubble.textContent=input.value;$('#demo-message-thread').appendChild(bubble);input.value='';toast('Message sent')})
  $$('[data-ticket-code]').forEach(btn=>btn.addEventListener('click',()=>{btn.textContent='QR ready ✓';toast('Ticket code revealed')}))
  $$('.match-card button').forEach(btn=>btn.addEventListener('click',()=>{btn.textContent='✓';btn.style.background='var(--pink)';confetti();toast('It’s a match! Conversation opened')}))
}

function openApp(){$('#app-demo').classList.add('is-open');$('#app-demo').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';renderAppView(state.currentView);setTimeout(()=>$('.close-app')?.focus(),120)}
function closeApp(){$('#app-demo').classList.remove('is-open');$('#app-demo').setAttribute('aria-hidden','true');document.body.style.overflow=''}

const modalContent={
  waitlist:`<div class="modal-icon">✦</div><h2 id="modal-title">Get in the first Puddle.</h2><p>Join the Toronto beta and be first to swipe through events, meet your crowd and make plans that actually leave the group chat.</p><form class="modal-form" data-waitlist-form><label>Email<input type="email" required placeholder="you@email.com"></label><label>What are you into?<select><option>Live music & nightlife</option><option>Food & pop-ups</option><option>Art & workshops</option><option>Sports & wellness</option><option>A little of everything</option></select></label><button class="button button--pink" type="submit">Join the beta →</button></form>`,
  organizer:`<div class="modal-icon">◉</div><h2 id="modal-title">Make your event impossible to miss.</h2><p>Create an organizer profile, publish an event and reach people based on intent—not just whoever the algorithm already follows.</p><form class="modal-form" id="organizer-form"><label>Organization or event name<input required placeholder="Afterglow Studio"></label><label>Contact email<input type="email" required placeholder="hello@studio.com"></label><label>Event type<select><option>Nightlife</option><option>Music</option><option>Workshop</option><option>Food</option><option>Sports</option><option>Other</option></select></label><button class="button button--pink" type="submit">Request organizer access →</button></form>`,
  safety:`<div class="modal-icon">⌾</div><h2 id="modal-title">Puddle’s safety model.</h2><p>Social features are designed around explicit consent, clear visibility and hard age boundaries.</p><div class="modal-list"><article><strong>18+ social matching</strong><p>Dating-oriented discovery and live friend location are limited to adults. Adult/minor profile matching is structurally blocked.</p></article><article><strong>Opt-in attendee visibility</strong><p>Attendance can remain hidden, friends-only, attendee-only or public on an event-by-event basis.</p></article><article><strong>Temporary location</strong><p>Location sessions name every viewer, always expire and can be stopped instantly.</p></article><article><strong>Block everywhere</strong><p>A block applies across profiles, matching, messages, comments, chats and location access.</p></article></div>`,
  privacy:`<div class="modal-icon">◌</div><h2 id="modal-title">Privacy by default.</h2><p>This prototype stores interactions only in your current browser session. A production release will provide purpose-specific consent, export, correction and deletion controls before collecting personal information.</p>`,
  terms:`<div class="modal-icon">☼</div><h2 id="modal-title">Production terms pending.</h2><p>Puddle’s final Terms, Organizer Agreement, Ticket Buyer Terms, Refund Policy and social safety rules require professional legal review before public launch.</p>`
}

function openModal(type){$('#modal-content').innerHTML=modalContent[type]||modalContent.waitlist;$('#modal-backdrop').classList.add('is-open');$('#modal-backdrop').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';setTimeout(()=>$('.modal-close').focus(),80);bindModalForms()}
function closeModal(){$('#modal-backdrop').classList.remove('is-open');$('#modal-backdrop').setAttribute('aria-hidden','true');document.body.style.overflow=''}
function bindModalForms(){
  $$('[data-waitlist-form]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();closeModal();confetti();toast('You’re on the Puddle beta list ✦')}))
  $('#organizer-form')?.addEventListener('submit',event=>{event.preventDefault();closeModal();confetti();toast('Organizer access requested — we’ll be in touch')})
}

function init(){
  renderDeck($('#hero-deck'),state.heroIndex,'hero')
  $$('[data-swipe]').forEach(btn=>btn.addEventListener('click',()=>btn.dataset.swipe==='undo'?undo('hero'):completeSwipe('hero',btn.dataset.swipe,$('#hero-deck').lastElementChild)))
  $('.round-action--share')?.addEventListener('click',()=>toast('Event link copied ↗'))
  $$('[data-open-app]').forEach(btn=>btn.addEventListener('click',openApp));$$('[data-close-app]').forEach(btn=>btn.addEventListener('click',closeApp));$$('[data-app-view]').forEach(btn=>btn.addEventListener('click',()=>renderAppView(btn.dataset.appView)))
  $$('[data-open-modal]').forEach(btn=>btn.addEventListener('click',()=>openModal(btn.dataset.openModal)));$$('[data-close-modal]').forEach(btn=>btn.addEventListener('click',closeModal));$('#modal-backdrop')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeModal()})
  $$('[data-waitlist-form]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();form.reset();confetti();toast('You’re on the Puddle beta list ✦')}))
  $('.menu-button')?.addEventListener('click',event=>{const header=$('#site-header');const open=header.classList.toggle('menu-open');event.currentTarget.setAttribute('aria-expanded',String(open))})
  window.addEventListener('scroll',()=>$('#site-header').classList.toggle('is-scrolled',window.scrollY>20),{passive:true})
  const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target)}}),{threshold:.12});$$('.reveal').forEach(el=>revealObserver.observe(el))
  const countObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;const el=entry.target;const target=Number(el.dataset.count);let start=0;const tick=()=>{start+=Math.max(1,Math.ceil((target-start)/14));el.textContent=start.toLocaleString();if(start<target)requestAnimationFrame(tick)};tick();countObserver.unobserve(el)}),{threshold:.5});$$('[data-count]').forEach(el=>countObserver.observe(el))
  $$('.tilt-card').forEach(card=>{card.addEventListener('pointermove',event=>{const r=card.getBoundingClientRect();const x=(event.clientX-r.left)/r.width-.5;const y=(event.clientY-r.top)/r.height-.5;card.style.transform=`perspective(900px) rotateX(${-y*3}deg) rotateY(${x*4}deg)`});card.addEventListener('pointerleave',()=>card.style.transform='')})
  $$('.mini-like').forEach(btn=>btn.addEventListener('click',()=>{btn.classList.toggle('is-liked');btn.textContent=btn.classList.contains('is-liked')?'✓':'♥';toast(btn.classList.contains('is-liked')?'Added to your people deck':'Removed from your people deck')}))
  $('#marketing-chat-form')?.addEventListener('submit',event=>{event.preventDefault();const input=$('input',event.currentTarget);if(!input.value.trim())return;const row=document.createElement('div');row.className='chat-row chat-row--self';row.innerHTML=`<p><strong>You</strong>${input.value.replace(/[<>]/g,'')}</p>`;$('#marketing-chat').appendChild(row);input.value='';toast('Message sent to the crew')})
  $('#location-toggle')?.addEventListener('click',event=>{const map=$('#location-map');const sharing=map.classList.toggle('is-sharing');event.currentTarget.textContent=sharing?'Stop sharing':'Share for 1 hour';toast(sharing?'Location sharing started for 1 hour':'Location sharing stopped')})
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeModal();closeApp()}})
}

document.addEventListener('DOMContentLoaded',init)
