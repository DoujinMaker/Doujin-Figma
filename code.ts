figma.showUI(__html__, { width: 320, height: 720 });

const FRAME_TYPE_NAME = "FRAME";

class Cache{
  type: string = "";
  url: string ="";
  api_key: string = "";
}
class Settings extends Cache{
  static getInstance(cache: Cache) {
    let settings = new Settings();
    const merge = Object.assign({}, settings, cache);
    Object.assign(settings, merge);
    return settings;
  }

  async save() {
    await figma.clientStorage.setAsync("settings", JSON.stringify(this));
  }
  async load() {
    try{
      let settings_str = await figma.clientStorage.getAsync("settings");
      if (settings_str) {
        let cached_settings = JSON.parse(settings_str);
        Object.assign(this, cached_settings);
      }
    }catch(e: any){
      if(debugMode())console.log(e.message)
    }
  }
  toJson() {
    return JSON.stringify(this);
  }
  getHeaders() {
    return { 'Content-Type': 'application/json', "Authorization": this.api_key };
  }
}
let settings = new Settings();
let cache = new Cache();
async function initialize() {
  await settings.load();
  const merge = Object.assign({}, cache, settings);
  Object.assign(cache, merge)
  settings = Settings.getInstance(cache);
  const selection = figma.currentPage.selection;
  console.log(selection);
  if (debugMode()) console.log("initialized");
  figma.ui.postMessage({ type: 'sync_settings', settings: settings.toJson() });
}
initialize()

const figmaUiMessageHandler=async (msg:any)=>{
  let ui_cache:Cache = JSON.parse(msg.cache);
  const merge = Object.assign({}, cache, ui_cache);
  Object.assign(cache, merge);
  const type = msg.type;
  try{
    switch (type) {
      case "save_settings":
        settings = Settings.getInstance(cache);
        await settings.save();
        if (debugMode()) console.log("Settings saved");
        figma.ui.postMessage({ type: 'saved_settings', settings: JSON.stringify(settings) });
        break;
        case "focus_selected_items":
          if (figma.currentPage.selection.length > 0)
            figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
          else
            figma.notify("Please select items to focus");
          break;
      case "focus_frame":
        if (figma.currentPage.selection.length > 0){
          let frame=selectFrameFromSelection(figma.currentPage.selection);
          if(frame){
            figma.viewport.scrollAndZoomIntoView([frame]);
            figma.currentPage.selection = [frame];
          }
        }else{
          figma.notify("Please select items that have frame to focus");
        }
        break;
    }
  }catch(e: any){
    if(debugMode())console.log(e)
    figma.ui.postMessage({ type: 'error', message: e.message });
  }
}
figma.ui.onmessage = figmaUiMessageHandler;

function debugMode(){
  return true;
}
function selectFrameFromSelection(selection: readonly SceneNode[]) {
  let frame = null;
  for (const selected_item of selection) {
    if (selected_item.type === FRAME_TYPE_NAME) {
      frame = selected_item;
      break;
    }
  }
  if (frame === null) {
    for (const selected_item of selection){
      frame = getFrameFromNode(selected_item);
    }
  }
  return frame;
}
function getFrameFromNode(node: BaseNode|null) {
  let frame = null;
  if (node === null) return frame;
  while (node.parent != null) {
    if (node.type === FRAME_TYPE_NAME) {
      frame = node;
      break;
    }
    node = node.parent;
  }
  return frame;
}