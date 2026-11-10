import './styles.css';
import { Game } from './game/Game';
import { getLang, onLangChange } from './ui/i18n';
import { getLevel, listLevels, type PlayableScene } from './game/LevelRegistry';
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas element.');
const gameCanvas = canvas;
let active: PlayableScene = new Game(canvas);
let activeId = 'orchard';
let selectedId = 'orchard';
let generation = 0;
let loading = false;
let loadError = false;
active.start();document.body.dataset.level='orchard';
const selector = document.querySelector<HTMLElement>('#level-selector')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-button')!;
function renderSelection(): void {
  const locale = getLang()==='zh'?'zh':'en';
  selector.replaceChildren();
  for(const level of listLevels()){
    const card=document.createElement('button');card.type='button';card.className=`level-card level-card-${level.id}`;
    card.disabled=loading;card.dataset.level=level.id;card.setAttribute('role','radio');card.setAttribute('aria-checked',String(level.id===selectedId));
    const name=document.createElement('strong');name.textContent=level.name[locale];
    const desc=document.createElement('span');desc.textContent=level.description[locale];card.append(name,desc);
    card.addEventListener('click',()=>{selectedId=level.id;loadError=false;renderSelection();});selector.append(card);
  }
  startButton.textContent=loading?(locale==='zh'?'正在加载场景…':'Loading scene…'):(locale==='zh'?'进入所选关卡':'Enter selected level');
  startButton.disabled=loading;
  document.querySelector('#menu-selection-name')!.textContent=getLevel(selectedId).name[locale];
  for(const button of document.querySelectorAll('.return-level-menu'))button.textContent=locale==='zh'?'返回关卡选择':'Level selection';
  document.querySelector('#menu-caption')!.textContent=loadError?(locale==='zh'?'场景加载失败，请刷新页面重试。':'Scene failed to load. Refresh the page to retry.'):(locale==='zh'?'选择一段夜行。带回你找到的秘密。':'Choose an expedition. Return with its secrets.');
  const brief=document.querySelector<HTMLElement>('#city-menu-brief')!;brief.hidden=selectedId!=='city';
  brief.children[0].textContent=locale==='zh'?'穿行红瓦石城，搜取情报图纸，躲避或反击巨人，然后抵达城门撤离。':'Search the red-roofed city for intel blueprints. Evade or fight the giants, then extract at the signal gate.';
  brief.children[1].textContent=locale==='zh'?'WASD 移动 · E 搜索 · Q / 空格 / 右键反击 · F 灯笼 · Esc 暂停':'WASD move · E search · Q / Space / right click strike · F lantern · Esc pause';
  document.querySelector<HTMLElement>('#orchard-menu-brief')!.hidden=selectedId==='city';
}
async function enterSelected(event: Event): Promise<void> {
  if(loading){event.stopImmediatePropagation();return;}
  if(selectedId==='orchard' && activeId==='orchard') return; // Original level owns its unchanged start behavior.
  event.stopImmediatePropagation();
  loading=true;loadError=false;renderSelection();const ticket=++generation;
  try{
    // Only the chosen scene factory is loaded; the previous scene is disposed before construction.
    const definition=getLevel(selectedId);
    active.dispose();
    const scene=await definition.load(gameCanvas);
    if(ticket!==generation){scene.dispose();return;}
    active=scene;activeId=definition.id;
    document.body.classList.toggle('level-city',activeId==='city');
    document.body.dataset.level=activeId;
    active.start();active.startRun();
  }catch(error){
    console.error(error);
    loadError=true;
    active=new Game(gameCanvas);activeId='orchard';document.body.classList.remove('level-city');document.body.dataset.level='orchard';active.start();
  }finally{loading=false;renderSelection();}
}
startButton.addEventListener('click',enterSelected,true);
async function showMenu(): Promise<void> {
  generation++;active.dispose();document.body.classList.remove('level-city');document.body.dataset.level='orchard';
  active=new Game(gameCanvas);activeId='orchard';active.start();renderSelection();
}
const menuButtons=document.querySelectorAll('.return-level-menu');
for(const button of menuButtons)button.addEventListener('click',showMenu);
const unsubscribe=onLangChange(renderSelection);
renderSelection();
if(import.meta.hot)import.meta.hot.dispose(()=>{generation++;active.dispose();unsubscribe();for(const button of menuButtons)button.removeEventListener('click',showMenu);startButton.removeEventListener('click',enterSelected,true);});
