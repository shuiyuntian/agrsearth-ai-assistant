/**
 * 文件作用：tool-catalog 页面视图
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

// ============================================================
// AI 助手工具目录快照（管理端展示用）
// 数据源：extensions/system/business/ai-assistant-mcp/contracts/tool-contracts.json
//   version=1, generatedAt=2026-07-26T03:20:16.299Z, toolCount=45
// 契约更新后需同步重新生成本文件（仅保留 name/domain/riskLevel/description）
// ============================================================
export interface ToolCatalogItem {
  name: string
  domain: string
  riskLevel: 'read' | 'write' | 'destructive'
  description: string
}

export const TOOL_CATALOG: ToolCatalogItem[] = [
  {
    "name": "animation_camera_tracking",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Make the camera follow an animated entity or stop tracking to return control to user"
  },
  {
    "name": "animation_control",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Start, pause, or resume animation playback"
  },
  {
    "name": "animation_create",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Create an animated entity with custom position samples. Provide positionSamples array with timing and coordinates."
  },
  {
    "name": "animation_list_active",
    "domain": "animation",
    "riskLevel": "read",
    "description": "Get a list of all active animations with their current states"
  },
  {
    "name": "animation_remove",
    "domain": "animation",
    "riskLevel": "destructive",
    "description": "Remove an animation and its associated entity"
  },
  {
    "name": "animation_update_path",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Update the visual appearance of an existing animation path trail (lead/trail time, width, color)"
  },
  {
    "name": "clock_control",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Configure the global animation clock. Can set full configuration, just the current time, or just the multiplier"
  },
  {
    "name": "globe_set_lighting",
    "domain": "animation",
    "riskLevel": "write",
    "description": "Enable or disable realistic globe lighting effects for day/night cycles"
  },
  {
    "name": "camera_fly_to",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Execute camera fly operation with advanced options like easing functions and callbacks"
  },
  {
    "name": "camera_get_position",
    "domain": "camera",
    "riskLevel": "read",
    "description": "Get comprehensive camera information including position, orientation, and view bounds"
  },
  {
    "name": "camera_look_at_transform",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Lock the camera to look at a specific point on Earth, useful for orbiting around landmarks"
  },
  {
    "name": "camera_set_controller_options",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Configure camera movement constraints and behavior"
  },
  {
    "name": "camera_set_view",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Instantly set camera position and orientation without animation"
  },
  {
    "name": "camera_start_orbit",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Start orbiting around the current look-at target"
  },
  {
    "name": "camera_stop_orbit",
    "domain": "camera",
    "riskLevel": "write",
    "description": "Stop the current camera orbit animation"
  },
  {
    "name": "cesium_disable_domain",
    "domain": "discovery",
    "riskLevel": "write",
    "description": "Disable a Cesium tool domain, hiding its tools from the tool list. Can be re-enabled later."
  },
  {
    "name": "cesium_enable_domain",
    "domain": "discovery",
    "riskLevel": "write",
    "description": "Enable a previously disabled Cesium tool domain, making its tools available again"
  },
  {
    "name": "cesium_list_domains",
    "domain": "discovery",
    "riskLevel": "read",
    "description": "List all available Cesium tool domains with their enabled/disabled status and tool counts"
  },
  {
    "name": "entity_add_billboard",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a billboard (image marker) entity at a specific location. Billboards are always screen-oriented and useful for icons and image markers. IMPORTANT: Always ask the user for an image URL before calling this tool, unless they already provided one. Do NOT invent or guess image URLs."
  },
  {
    "name": "entity_add_box",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a box entity at a specific location with customizable dimensions. Boxes are useful for representing buildings, containers, or volumetric data."
  },
  {
    "name": "entity_add_corridor",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a corridor entity along a path with specified width. Corridors are useful for representing roads, pipelines, routes, or paths."
  },
  {
    "name": "entity_add_cylinder",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a cylinder or cone entity at a specific location. Cylinders are useful for representing towers, pillars, or volumetric structures."
  },
  {
    "name": "entity_add_ellipse",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create an ellipse entity at a specific location with customizable appearance. Ellipses are useful for representing circular areas, zones, or coverage regions."
  },
  {
    "name": "entity_add_label",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a text label entity at a specific location. Labels are useful for annotations, names, and information display."
  },
  {
    "name": "entity_add_model",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a 3D model entity (glTF/GLB) at a specific location with orientation. Models are useful for buildings, vehicles, and complex 3D objects. IMPORTANT: Always ask the user for a model URL before calling this tool, unless they already provided one. Do NOT invent or guess model URLs."
  },
  {
    "name": "entity_add_point",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a point entity at a specific location with customizable appearance. Use this to add markers, landmarks, or points of interest to the 3D scene."
  },
  {
    "name": "entity_add_polygon",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a polygon entity from an array of positions. Polygons are useful for areas, zones, and regions."
  },
  {
    "name": "entity_add_polyline",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a polyline entity connecting multiple positions. Polylines are useful for paths, routes, and connections."
  },
  {
    "name": "entity_add_rectangle",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a rectangle entity defined by geographic bounds. Rectangles are useful for representing regions, bounding boxes, or areas of interest."
  },
  {
    "name": "entity_add_wall",
    "domain": "entity",
    "riskLevel": "write",
    "description": "Create a wall entity from a series of positions with variable heights. Walls are useful for representing barriers, fences, or vertical structures."
  },
  {
    "name": "entity_list",
    "domain": "entity",
    "riskLevel": "read",
    "description": "Get a list of all entities currently in the scene with their IDs, names, and types. Optionally filter by entity type or include detailed information."
  },
  {
    "name": "entity_remove",
    "domain": "entity",
    "riskLevel": "destructive",
    "description": "Remove an entity from the scene by ID or name pattern. Can remove a single entity or all matching entities."
  },
  {
    "name": "geolocation_geocode",
    "domain": "geolocation",
    "riskLevel": "write",
    "description": "Convert an address, landmark, or place name to geographic coordinates. Use this for \"What are the coordinates of X?\" or \"Where is X located?\" queries. Examples: \"Empire State Building\", \"Eiffel Tower\", \"1600 Pennsylvania Avenue\", \"Tokyo Tower\", \"Tokyo, Japan\". Returns a SINGLE best matching location (not a list). DO NOT use for finding multiple businesses by category (use geolocation_search for \"find restaurants\", \"find hotels\", etc.)."
  },
  {
    "name": "geolocation_route",
    "domain": "geolocation",
    "riskLevel": "write",
    "description": "Calculate optimal route between two locations with support for multiple travel modes (driving, walking, cycling, transit) and traffic awareness."
  },
  {
    "name": "geolocation_search",
    "domain": "geolocation",
    "riskLevel": "write",
    "description": "Search for MULTIPLE POIs by category or business type (e.g., \"pizza restaurants\", \"gyms\", \"coffee shops\", \"hotels\", \"gas stations\"). Use this for finding businesses and amenities, NOT for single landmarks. Returns MULTIPLE matching places. Supports both general search and location-based (nearby) search - use location + radius parameters for nearby searches like \"gyms near Golden Gate Bridge\". DO NOT use for \"What are the coordinates of Empire State Building\" or similar landmark queries - use geolocation_geocode instead. Supports location-biased search, radius filtering, and type filtering."
  },
  {
    "name": "imagery_add",
    "domain": "imagery",
    "riskLevel": "write",
    "description": "Add a new imagery layer to the globe. Supports various provider types including URL templates, WMS, WMTS, ArcGIS, Bing Maps, TMS, OpenStreetMap, Cesium Ion, and single tile providers."
  },
  {
    "name": "imagery_list",
    "domain": "imagery",
    "riskLevel": "read",
    "description": "Get a list of all imagery layers currently on the globe with their indices, names, visibility, and provider types."
  },
  {
    "name": "imagery_remove",
    "domain": "imagery",
    "riskLevel": "destructive",
    "description": "Remove an imagery layer from the globe by index or name. Can remove a single layer or all non-base imagery layers."
  },
  {
    "name": "terrain_get",
    "domain": "terrain",
    "riskLevel": "read",
    "description": "Get information about the current terrain provider in the Cesium scene, including its source type, name, and configuration."
  },
  {
    "name": "terrain_remove",
    "domain": "terrain",
    "riskLevel": "destructive",
    "description": "Remove the current terrain provider and reset to the default WGS84 ellipsoid (flat globe with no terrain elevation data)."
  },
  {
    "name": "terrain_set",
    "domain": "terrain",
    "riskLevel": "write",
    "description": "Set the terrain provider for the Cesium scene. Supports Cesium Ion terrain assets (type='ion'), direct terrain server URLs (type='url'), and WGS84 ellipsoid (type='ellipsoid') for a flat globe with no terrain. The default Cesium World Terrain can be loaded with type='ion' and assetId=1."
  },
  {
    "name": "tileset_add",
    "domain": "tiles",
    "riskLevel": "write",
    "description": "Add a 3D Tiles tileset to the Cesium scene. Supports loading from Cesium Ion assets (type='ion') and direct tileset.json URLs (type='url'). Returns a tilesetId that can be used to remove the tileset later."
  },
  {
    "name": "tileset_list",
    "domain": "tiles",
    "riskLevel": "read",
    "description": "Get a list of all 3D tilesets currently loaded in the Cesium scene, including their IDs, names, source types, and visibility state. Use tilesetIds from this list with tileset_remove."
  },
  {
    "name": "tileset_remove",
    "domain": "tiles",
    "riskLevel": "destructive",
    "description": "Remove a 3D tileset from the Cesium scene. Identify the tileset to remove by its tilesetId (returned by tileset_add), by name, or set removeAll=true to remove all loaded tilesets at once."
  },
  {
    "name": "tileset_style",
    "domain": "tiles",
    "riskLevel": "write",
    "description": "Apply or update 3D Tiles styling (color and show conditions) on a loaded tileset. Target the tileset by tilesetId (from tileset_add) or by name. Use color for a single color expression, colorConditions for conditional coloring, show/showConditions for visibility rules. IMPORTANT: The 3D Tiles Styling expression language only supports color() with hex or named color strings (e.g. color('#ff0000'), color('red')). CSS functions like hsl(), rgb(), or rgba() are NOT supported and will silently fail. To create a color ramp based on a feature property (e.g. Height), always use colorConditions with discrete ranges instead of a single color expression. Example: colorConditions=[['${Height} >= 100', \"color('#ff0000')\"], ['true', \"color('#00ff00')\"]]"
  }
]

// 域中文标签（展示分组标题用）
export const DOMAIN_LABELS: Record<string, string> = {
  animation: '动画控制',
  camera: '相机视角',
  discovery: '能力域管理',
  entity: '实体绘制',
  geolocation: '地理定位',
  imagery: '影像图层',
  terrain: '地形',
  tiles: '3D Tiles'
}
