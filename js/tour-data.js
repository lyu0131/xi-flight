/* tour-data.js: the scenic tour (TOUR mode, ball.js): a loop of Europe's mountains, rivers and valleys from the Naples
   start (owner, 2026-10-09). Each highlight is a pass flown low and slow along `path` ([lat, lon] waypoints, through the
   towns along each river, valley and fjord, then snapped to the lowest ground within ~1 km by a survey of the 3D
   Earth); `agl` km over the ground beneath (the relief is 3x, earth3d.js EXAG: a valley's walls rise three times as
   high); `floor` the valley floor's real height in km (a guess at the ground before its 3D tiles are in). */
(function (S) {
  S.TOUR = [
    { name: 'AMALFI COAST', agl: 0.5, floor: 0, path: [[40.62, 14.45], [40.624, 14.485], [40.607, 14.53], [40.618, 14.565], [40.628, 14.603]] },   // offshore: Positano, Praiano, Amalfi
    { name: 'IRON GATES', agl: 0.5, floor: 0.07, path: [[44.656, 21.631], [44.6454, 21.7626], [44.629, 21.9076], [44.5446, 22.0374], [44.4668, 22.1394], [44.5146, 22.2074], [44.62, 22.27], [44.669, 22.3449], [44.701, 22.4076]] },   // the Danube: Golubac, Donji Milanovac, the Kazan, Orsova
    { name: 'HIGH TATRAS', agl: 1.5, floor: 0.9, path: [[49.12, 19.93], [49.21, 20.28]] },   // along the south face, Kriváň to Lomnický štít
    { name: 'WACHAU', agl: 0.5, floor: 0.2, path: [[48.405, 15.6], [48.404, 15.5119], [48.389, 15.4619], [48.3606, 15.4184], [48.293, 15.405], [48.239, 15.3431]] },   // the Danube: Krems, Dürnstein, Spitz, Melk
    { name: 'LAKE BLED', agl: 0.6, floor: 0.5, path: [[46.355, 14.0888], [46.33, 14.0556], [46.2882, 13.993], [46.2812, 13.9654], [46.2862, 13.8766], [46.285, 13.84]] },   // Bled down the Sava Bohinjka to Lake Bohinj
    { name: 'DOLOMITES', agl: 1.5, floor: 1.8, path: [[46.62, 12.3], [46.57, 11.67]] },   // the Tre Cime west to Val Gardena
    { name: 'LAUTERBRUNNEN', agl: 0.5, floor: 0.8, path: [[46.632, 7.902], [46.594, 7.909], [46.574, 7.9086], [46.5558, 7.903]] },   // down the valley of waterfalls
    { name: 'MATTERHORN', agl: 0.8, floor: 1.6, path: [[46.186, 7.8092], [46.099, 7.781], [46.069, 7.777], [46.02, 7.749], [45.9652, 7.658]] },   // up the Mattertal past Zermatt to the peak
    { name: 'MONT BLANC', agl: 0.6, floor: 1.0, path: [[45.974, 6.9182], [45.9168, 6.8638], [45.8936, 6.7887]] },   // the Chamonix valley under the massif
    { name: 'VERDON GORGE', agl: 0.4, floor: 0.6, path: [[43.8416, 6.503], [43.83, 6.455], [43.7896, 6.4035], [43.7758, 6.36], [43.764, 6.295], [43.76, 6.2451], [43.7704, 6.2185]] },   // Castellane to the lake
    { name: 'ORDESA', agl: 0.6, floor: 1.3, path: [[42.684, 0.0413], [42.664, -0.0024], [42.6486, -0.0598], [42.65, -0.0656], [42.619, -0.1134]] },   // down the canyon from Monte Perdido to Torla
    { name: 'GLEN COE', agl: 0.4, floor: 0.2, path: [[56.6444, -4.8664], [56.6582, -4.8919], [56.664, -4.9796], [56.6668, -5.0265], [56.6746, -5.0764], [56.683, -5.1]] },   // Kingshouse west through the glen
    { name: 'GEIRANGERFJORD', agl: 0.3, floor: 0, path: [[62.0858, 6.8777], [62.0842, 6.8762], [62.1122, 6.9346], [62.106, 7.0315], [62.107, 7.1015], [62.112, 7.1615], [62.1, 7.2]] },   // Hellesylt up the fjord to Geiranger
    { name: 'RHINE GORGE', agl: 0.4, floor: 0.07, path: [[50.3498, 7.6008], [50.3, 7.6], [50.274, 7.645], [50.2346, 7.6012], [50.2014, 7.6434], [50.152, 7.712], [50.149, 7.7234], [50.108, 7.727], [50.0816, 7.766], [50.058, 7.769], [50.04, 7.81], [50.0154, 7.8472], [49.9724, 7.885]] }   // Koblenz, Boppard, St. Goar, the Lorelei, Bacharach, Bingen
  ];
})(window.SITE5);
