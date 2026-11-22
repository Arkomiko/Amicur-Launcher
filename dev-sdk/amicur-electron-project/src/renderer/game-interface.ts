import type { GameLanguage } from '../shared/types.js';

const ru = new Map(Object.entries({
  'Settings': 'Настройки', 'Change font': 'Шрифт', 'Change font size': 'Размер шрифта',
  'Change theme': 'Тема', 'Analytics Enabled': 'Сбор статистики',
  'Sans-Serif': 'Без засечек', 'Serif': 'С засечками', 'Open Dyslexic': 'OpenDyslexic',
  'Dark Theme': 'Тёмная', 'Light Theme': 'Светлая', 'Ask': 'Спрашивать',
  'Enabled': 'Включён', 'Disabled': 'Выключен',
  'OK': 'Готово', 'Reset to Defaults': 'Сбросить настройки', 'Close': 'Закрыть',
  'By': 'От', 'By amaty': 'От amaty', 'amaty': 'amaty',
  'Stats Overview': 'Характеристики', 'Widgets': 'Виджеты', 'Toggle stats widget': 'Показать или скрыть характеристики',
  'No stats selected. Please go to the menu and click on widgets to choose which stats to display.':
    'Характеристики не выбраны. Открой «Виджеты» в меню и отметь, что показывать.',
  'Customize Stats Widget': 'Настройка виджета характеристик',
  'Select which stats to show in the sidebar.': 'Выбери, какие характеристики показывать в боковой панели.',
  'New Game': 'Новая игра', 'Load Game': 'Загрузить игру', 'Continue': 'Продолжить',
  'Saves': 'Сохранения', 'Save': 'Сохранить', 'Load': 'Загрузить', 'Delete': 'Удалить',
  'Delete All': 'Удалить все', 'Clear': 'Очистить', 'Export': 'Экспорт', 'Import': 'Импорт',
  'Browser': 'В браузере', 'Disk': 'На диске', 'Auto': 'Авто', 'Autosave': 'Автосохранение',
  'Auto Saves': 'Автосохранения', 'Slots': 'Слоты', 'Slot': 'Слот', 'Empty': 'Пусто',
  'unknown date': 'дата неизвестна', 'Turn': 'Ход', 'On': 'Вкл.', 'Off': 'Выкл.',
}));

const stats = new Map(Object.entries({
  Femininity: 'Женственность', MAttraction: 'Влечение к мужчинам', FAttraction: 'Влечение к женщинам',
  Transgender: 'Трансгендерность', Acceptance: 'Принятие', Studies: 'Учёба', Athleticism: 'Атлетизм',
  Social: 'Общительность', Popularity: 'Популярность', Magic: 'Магия',
  Cheerleading: 'Чирлидинг', Flair: 'Актёрское мастерство', Art: 'Искусство',
}));
const characters = new Map(Object.entries({
  Luke: 'Люк', Samantha: 'Саманта', Jessica: 'Джессика',
  Vincent: 'Винсент', Aurora: 'Аврора', Jordan: 'Джордан',
}));

function statText(source: string): string | undefined {
  const key = source.replace(/:$/, '');
  const relationship = /^(\w+)(Relo|Romance)$/.exec(key);
  const character = relationship && characters.get(relationship[1]);
  const name = character && relationship ? character + (relationship[2] === 'Relo' ? ' (отношения)' : ' (романтика)') : stats.get(key);
  return name && name + (source.endsWith(':') ? ':' : '');
}

const intro = new Map(Object.entries({
  "A Mirror's Curse": '«Проклятие зеркала»', Ethan: 'Итан', In: 'В игре',
  Click: 'Нажми', begin: '«Начать»', exit: '«Выйти»',
  "to start your journey if you're over the age of 18, or": ', если тебе уже есть 18, или',
  "if you're a minor.": ', если тебе ещё нет 18.',
  Begin: 'Начать', Exit: 'Выйти', 'Play 2025 April Fools Update': 'Первоапрельское обновление 2025',
}));
const introParagraphs = [
  {
    start: 'is a transgender transformation game created in Twine using the Sugarcube format.',
    end: 'visiting the Autumn Festival with friends takes a strange turn. There,',
    text: '- интерактивная история о гендерной трансформации, созданная в Twine на движке SugarCube. Ты играешь за Итана Юна, старшеклассника, чья жизнь поначалу ничем не примечательна. Всё меняется после похода с друзьями на Осенний фестиваль. Там',
  },
  {
    start: 'encounters Madame Serena, a mysterious seer',
    end: 'with every traditionally feminine action he takes.',
    text: 'встречает мадам Серену, загадочную провидицу. Узнав, что Итан тайком записал их разговор, она проклинает его. Смысл её предупреждения о зеркале, которое будет меняться всякий раз, когда он действует вслепую, проясняется, когда начинает меняться сам Итан. С каждым поступком, который принято считать женственным, он выглядит всё женственнее.',
  },
  {
    start: "you'll navigate the complexities of magic, impress your teachers",
    end: 'uncover a new version of yourself reflected in the mirror?',
    text: 'тебе предстоит освоить магию, удивить учителей и понять себя к концу выпускного класса. Твои решения определят, чему ты посвятишь этот год. Можно сосредоточиться на учёбе, дружбе, отношениях или других делах. Тебя ждут шесть романтических линий, четыре школьных клуба, пять вариантов будущего и три пути, по которым Итан может прийти к пониманию своей идентичности. Попробуешь сохранить привычное представление о себе или примешь перемены и узнаешь, кто смотрит на тебя из зеркала?',
  },
];

const uiArea = '#ui-dialog-titlebar, #ui-dialog-body.settings, #ui-dialog-body.saves, .story-author, #stats-widget, #toggle-stats-widget, .passage.loading-page nav, .passage.loading-page .credit';
const attrs = ['title', 'aria-label'] as const;
const originals = new WeakMap<Element, Map<string, { source: string; output: string }>>();

export function interfaceText(parent: HTMLElement, source: string, language: GameLanguage): string | undefined {
  if (language === 'ru-RU' && parent.closest('[data-passage="AMC"]')) {
    return intro.get(source)
      ?? introParagraphs.find(item => source.startsWith(item.start) && source.endsWith(item.end))?.text;
  }
  if (!parent.closest(uiArea)) return;
  if (language !== 'ru-RU') return source;
  const stat = parent.closest('#stats-list') ? statText(source) : undefined;
  if (parent.closest('.passage.loading-page .credit')) {
    return source.replace(/\bVersion (?=\d)/, 'Версия ')
      .replace(/\bPublic NSFW\b/, 'Открытый релиз (18+)')
      .replace(/\bPublic SFW\b/, 'Открытый релиз (без откровенного контента)');
  }
  return ru.get(source) ?? stat ?? source;
}

function translateAttribute(element: Element, name: string, generated: string | null, language: GameLanguage): void {
  const previous = originals.get(element)?.get(name);
  const displayed = element.getAttribute(name);
  const source = previous?.output === displayed ? previous.source : (displayed ?? generated);
  if (!source) return;
  const output = language === 'ru-RU' ? ru.get(source) ?? source.replace(/^(\d+)px$/, '$1 пикс.') : source;
  const state = originals.get(element) ?? new Map();
  state.set(name, { source, output });
  originals.set(element, state);
  if (displayed !== output) element.setAttribute(name, output);
}

export function applyInterfaceLabels(language: GameLanguage): void {
  document.querySelectorAll<HTMLOptionElement>('#ui-dialog-body.settings select option:not([data-amicur-language] option)').forEach(option => {
    translateAttribute(option, 'label', option.textContent, language);
  });
  for (const area of document.querySelectorAll(uiArea)) {
    const elements = [area, ...area.querySelectorAll('[aria-label], [title]')];
    for (const item of elements) {
      if (item.closest('[data-amicur-mod]')) continue;
      for (const name of attrs) translateAttribute(item, name, null, language);
    }
  }
}

export const gameControlStyles = [
  '[data-amicur-locale="ru-RU"] .story-author{text-transform:none!important;font-variant:normal!important}',
  '[data-amicur-language]{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.65rem 0 .9rem}',
  '[data-amicur-language] select{max-width:65%;font:inherit;padding:.24rem .45rem;border:1px solid var(--color2,#9793c8)}',
  '#ui-dialog-body.saves:has([data-amicur-saves]){max-height:calc(100dvh - 8rem);overflow:auto}',
  '[data-amicur-saves]{padding:.8rem 1rem}',
  '[data-amicur-saves]>button{width:100%}',
  '[data-amicur-saves] .amicur-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;margin:.65rem 0}',
  '[data-amicur-saves] ul{padding:0;margin:.55rem 0;list-style:none;display:grid;gap:.35rem;max-height:12rem;overflow:auto}',
  '[data-amicur-saves] li button{width:100%;text-align:left;overflow-wrap:anywhere}',
  '[data-amicur-saves] p:empty{display:none}',
].join('\n');
