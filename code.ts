figma.showUI(__html__, { width: 320, height: 720 });

const FRAME_TYPE_NAME = "FRAME";
const DEBUG_MODE = false;
const DEFAULT_UPSCALE_SCALE=2

class Cache{
  settings_version: string = Settings.latest_settings_version;
  url: string ="";
  api_key: string = "";
  prompt: string = "";
  negative_prompt: string = "";
  step: number = 20;
  sampler: string = "Euler";
  seed: string = "-1";
  cfg_scale: number = 7;
  target_length: number = 1024;
  batch_size: number = 1;
  denoising_strength: number = 0.5;
  large_image: boolean = false;
  upscaler: string = "R-ESRGAN 4x+";
  alpha_matting_foreground_threshold:number=120;
  alpha_matting_background_threshold:number=10;
}
class Settings extends Cache{
  static latest_settings_version: string = "1.0.0";
  static getInstance(cache: Cache) {
    let settings = new Settings();
    const merge = Object.assign({}, settings, cache);
    Object.assign(settings, merge);
    return settings;
  }

  async save() {
    if(debugMode())console.log("Saving",this);
    await figma.clientStorage.setAsync("settings", JSON.stringify(this));
  }
  async load() {
    try{
      let settings_str = await figma.clientStorage.getAsync("settings");
      if (settings_str) {
        let cached_settings:Cache = JSON.parse(settings_str);
        if(cached_settings.settings_version&&cached_settings.settings_version==Settings.latest_settings_version)
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
    if (!this.api_key) return { 'Content-Type': 'application/json' };
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
  if(debugMode())console.log("Initialized with",settings);
  figma.ui.postMessage({ type: 'sync_settings', settings: settings.toJson(),debug_mode:debugMode() });
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
      case "txt2img":
        await txt2img();
        break;
      case "img2img":
        await img2img();
        break;
      case "remove_background":
        await removeBackground();
        break;
      case "get_background_mask":
        await get_background_mask();
        break
      case "upscale":
        await upscale();
        break;
    }
  }catch(e: any){
    if(debugMode())console.log(e)
    figma.ui.postMessage({ type: 'error', message: e.message });
  }
}
figma.ui.onmessage = figmaUiMessageHandler;

function debugMode(){
  return DEBUG_MODE;
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
async function txt2img(){
  const frame=figma.createFrame();
  frame.name=settings.prompt;
  frame.resize(settings.target_length,settings.target_length);
  frame.x=figma.viewport.center.x-frame.width/2;
  frame.y=figma.viewport.center.y-frame.height/2;
  frame.clipsContent=true;
  const optimistSize=getOptimistSize(frame);
  let query: any = {
    "prompt": settings.prompt,
    "negative_prompt": settings.negative_prompt,
    "steps": settings.step,
    "sampler_index": settings.sampler,
    "seed": settings.seed,
    "cfg_scale": settings.cfg_scale,
    "width": optimistSize.width,
    "height": optimistSize.height,
    "batch_size": settings.batch_size
  }
  if(debugMode())console.log("Query",query);
  figma.ui.postMessage({ type: 'generating' });
  let data = await getJsonResponse(`${settings.url}/sdapi/v1/txt2img`, query);
  if(debugMode())console.log("Response",data);
  const images=data['images'];
  for (const base64 of images) {
    const byte_array = await base64_to_Uint8Array(base64);
    create_image_node("txt2image", byte_array,frame, settings.prompt, frame.width, frame.height);
  }
  figma.ui.postMessage({ type: 'generated' });
}
async function img2img(){
  const frame=selectFrameFromSelection(figma.currentPage.selection);
  if (!frame) {
    figma.notify("Please select a frame or something that is within a frame to generate image");
    return;
  }
  const optimistSize=getOptimistSize(frame);
  const imageUrl = await extract_base64(frame);
  let query: any = {
    "init_images": [imageUrl],
    "denoising_strength": settings.denoising_strength,
    "prompt": settings.prompt,
    "negative_prompt": settings.negative_prompt,
    "steps": settings.step,
    "sampler_index": settings.sampler,
    "cfg_scale": 7,
    "width": optimistSize.width,
    "height": optimistSize.height,
    "seed": settings.seed,
    "batch_size": settings.batch_size
  }
  if(debugMode())console.log("Query",query);
  figma.ui.postMessage({ type: 'generating' });
  let data = await getJsonResponse(`${settings.url}/sdapi/v1/img2img`, query);
  if(debugMode())console.log("Response",data);
  const images=data['images'];
  for (const base64 of images) {
    const byte_array = await base64_to_Uint8Array(base64);
    create_image_node("img2img", byte_array,frame, settings.prompt, frame.width, frame.height);
  }
}
async function removeBackground(){
  const frame=selectFrameFromSelection(figma.currentPage.selection);
  if (!frame) {
    figma.notify("Please select a frame or something that is within a frame to generate image");
    return;
  }
  const newFrame=figma.createFrame();
  newFrame.name=frame.name;
  newFrame.resize(frame.width,frame.height);
  newFrame.x=figma.viewport.center.x-newFrame.width/2;
  newFrame.y=figma.viewport.center.y-newFrame.height/2;
  newFrame.clipsContent=true;
  const base64_frame = await extract_base64(frame);
  const base64_rmbg = await get_auto_mask(base64_frame, false);
  const byte_array = await base64_to_Uint8Array(base64_rmbg);
  create_image_node("removeBackground", byte_array,newFrame ,"removed-background-of--"+frame.name, newFrame.width, newFrame.height);
}
async function get_background_mask(){
  const frame=selectFrameFromSelection(figma.currentPage.selection);
  if (!frame) {
    figma.notify("Please select a frame or something that is within a frame to generate image");
    return;
  }
  const base64_frame = await extract_base64(frame);
  const base64_rmbg = await get_auto_mask(base64_frame, true);
  const svgstr = await img2svg(base64_rmbg);
  create_node_from_svg("get_background_mask", svgstr,frame ,"mask-of--"+frame.name, frame.width, frame.height);
}
function img2svg(base64:string){
  return new Promise<string>((resolve) => {
    function handleMessage(msg: any) {
      if (msg.type === "img2svg_result") {
        figma.ui.onmessage = figmaUiMessageHandler;
        resolve(msg.svgstr);
      }
    }
    figma.ui.onmessage = handleMessage;
    figma.ui.postMessage({ type: "img2svg", base64 });
  });
}
async function upscale(){
  const frame=selectFrameFromSelection(figma.currentPage.selection);
  if (!frame) {
    figma.notify("Please select a frame or something that is within a frame to generate image");
    return;
  }
  const newFrame=figma.createFrame();
  newFrame.name=frame.name;
  newFrame.resize(frame.width*DEFAULT_UPSCALE_SCALE,frame.height*DEFAULT_UPSCALE_SCALE);
  newFrame.x=figma.viewport.center.x-newFrame.width/2;
  newFrame.y=figma.viewport.center.y-newFrame.height/2;
  newFrame.clipsContent=true;
  const base64_frame = await extract_base64(frame);
  const base64_upscale = await upscale_image(base64_frame);
  const byte_array = await base64_to_Uint8Array(base64_upscale);
  create_image_node("upscale", byte_array,newFrame ,"upscaled--"+frame.name, newFrame.width, newFrame.height);

}

async function getJsonResponse(url: string, query: any) {
  try{
    let res = await fetch(url.replace("//sdapi","/sdapi").replace("//figma","/figma"), {
      method: 'POST',
      headers: settings.getHeaders(),
      body: JSON.stringify(query)
    }) as FetchResponse;
    return await res.json();
  }catch(e: any){
    if(e.message.includes("timeout"))
      figma.notify("Figma plugin server is not responding within limited time. Please try to lower the batch size, steps count or don't check the large image option. You can also use a more powerful GPU or wait for this plugin to updates.");
    if(debugMode())console.log(e.message);
    return {images:[]};
  }
}
async function get_auto_mask(imageUrl: string, mask_only: boolean) {
  let query: any = {
    "image_str": imageUrl,
    "alpha_matting": false,
    "alpha_matting_foreground_threshold": 120,
    "alpha_matting_background_threshold": 10,
    "alpha_matting_erode_size": 10,
    "session_name": "u2net",
    "only_mask": mask_only,
    "post_process_mask": true,
  }
  if(debugMode())console.log("Query",query);
  let data = await getJsonResponse(`${settings.url}/figma/auto_mask/remove-background`, query);
  const base64 = data['mask'];
  return base64;
}
async function upscale_image(imageUrl: string) {
  let query: any = {
    "resize_mode": 0,
    "show_extras_results": true,
    "gfpgan_visibility": 0,
    "codeformer_visibility": 0,
    "codeformer_weight": 0,
    "upscaling_resize": DEFAULT_UPSCALE_SCALE,
    "upscaling_crop": true,
    "upscaler_1": settings.upscaler,
    "upscale_first": false,
    "image": imageUrl
  }
  if(debugMode())console.log("Query",query);
  let data = await getJsonResponse(`${settings.url}/sdapi/v1/extra-single-image`, query);
  const base64 = data['image'];
  return base64;
}
async function create_image_node(original_task: string, byte_array: Uint8Array,frame:FrameNode, image_name=settings.prompt, width = -1, height = -1) {
  const imageNode = figma.createRectangle();
  const image = await figma.createImage(byte_array);
  if (width === -1 || height === -1) { let size = await image.getSizeAsync(); width = size.width; height = size.height; }
  imageNode.resize(width, height);
  imageNode.fills = [
    {
      type: 'IMAGE',
      imageHash: image.hash,
      scaleMode: 'FILL'
    }
  ]
  imageNode.name = image_name;
  frame.appendChild(imageNode);
  figma.ui.postMessage({ original_task, type: 'generated' });
  figma.commitUndo();
}
async function create_node_from_svg(original_task: string, svgstr: string,frame:FrameNode, image_name=settings.prompt, width=-1, height=-1) {
  const svgNode = figma.createNodeFromSvg(svgstr);
  if (width === -1 || height === -1) { width = frame.width; height = frame.height; }
  svgNode.resize(width, height);
  svgNode.name = image_name;
  frame.appendChild(svgNode);
  figma.ui.postMessage({ original_task, type: 'generated' });
  figma.commitUndo();
}
function getOptimistSize(frame:FrameNode){
  const width = frame.width;
  const height = frame.height;
  const targetWidth = settings.target_length;
  const aspectRatio = width / height;
  const referenceLogic=settings.large_image?width<height:width>height;
  if (referenceLogic) {
    return {
      width: targetWidth,
      height: targetWidth / aspectRatio
    };
  }else{
    return {
      width: targetWidth * aspectRatio,
      height: targetWidth
    };
  }
}
async function extract_base64(frame:FrameNode){
  const frameUint8array = await frame.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
  const base64 = await Uint8Array_to_base64(frameUint8array);
  return base64;
}
async function base64_to_Uint8Array(base64: string) {
  return new Promise<Uint8Array>((resolve) => {
    function handleMessage(msg: any) {
      if (msg.type === "Uint8Array_to_base64_result") {
        figma.ui.onmessage = figmaUiMessageHandler;
        resolve(msg.base64);
      }
      if (msg.type === "base64_to_Uint8Array_result") {
        figma.ui.onmessage = figmaUiMessageHandler;
        resolve(msg.uint8array);
      }
    }
    figma.ui.onmessage = handleMessage;
    figma.ui.postMessage({ type: "base64_to_Uint8Array", base64 });
  });
}
function Uint8Array_to_base64(uint8array: Uint8Array) {
  return new Promise<string>((resolve) => {
    function handleMessage(msg: any) {
      if (msg.type === "Uint8Array_to_base64_result") {
        figma.ui.onmessage = figmaUiMessageHandler;
        resolve(msg.base64);
      }
      if (msg.type === "base64_to_Uint8Array_result") {
        figma.ui.onmessage = figmaUiMessageHandler;
        resolve(msg.uint8array);
      }
    }
    figma.ui.onmessage = handleMessage;
    figma.ui.postMessage({ type: "Uint8Array_to_base64", uint8array });
  });
}