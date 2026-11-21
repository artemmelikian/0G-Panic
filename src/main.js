const { HangarScene } = await import('./scenes/Hangar.js?v=' + (window.BUILD || Date.now()));

const fit = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
window.RES = Math.min(3, Math.max(1, fit * (window.devicePixelRatio || 1)));

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.round(1280 * window.RES),
  height: Math.round(720 * window.RES),
  backgroundColor: '#2c5287',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  physics: { default: 'arcade', arcade: { fixedStep: false } },
  scene: [HangarScene],
});
