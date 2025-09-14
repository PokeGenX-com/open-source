document.addEventListener('DOMContentLoaded', () => {

  // -------- Chargement dynamique des données --------
  // Récupère la liste des Pokémon et des fonds depuis GitHub
  async function initData() {
    const pokemonsUrl = 'https://raw.githubusercontent.com/PokeGenX-com/data/refs/heads/PokeGenX/pokegenx.json';
    const backgroundsUrl = 'https://raw.githubusercontent.com/PokeGenX-com/data/refs/heads/PokeGenX/background.txt';

    const [pokemonsRes, backgroundsRes] = await Promise.all([
      fetch(pokemonsUrl),
      fetch(backgroundsUrl)
    ]);

    const pokemons = await pokemonsRes.json();
    const bgText = await backgroundsRes.text();
    const backgrounds = bgText
      .split(/\r?\n/)
      .filter(line => line.trim().length);

    // Expose globalement pour pouvoir y accéder ailleurs
    window.pokemons = pokemons;
    window.backgrounds = backgrounds;

    // Remplit les <select> pour Pokémon et fonds
    const pokemonSelect = document.getElementById('pokemon-select');
    const backgroundSelect = document.getElementById('background-select');
    pokemonSelect.innerHTML = '';
    backgroundSelect.innerHTML = '';

    pokemons.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `N°${p.pokedex_id} : ${p.name.fr}`;
      pokemonSelect.append(opt);
    });

    backgrounds.forEach((file, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = file;
      backgroundSelect.append(opt);
    });
  }

  // -------- Constantes globales --------
  const VIEW = { w: 260, h: 360 };
  const canvas = document.getElementById('card-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const dpr = window.devicePixelRatio || 1;

  // Ajuste la taille réelle du canvas pour éviter le flou
  canvas.width = VIEW.w * dpr;
  canvas.height = VIEW.h * dpr;
  canvas.style.width = `${VIEW.w}px`;
  canvas.style.height = `${VIEW.h}px`;
  ctx.scale(dpr, dpr);

  const state = {
    isBack: false,           // face actuelle du flip
    isFlipping: false,       // en cours d'animation
    config: null,            // données de la carte à dessiner
    imgCache: new Map(),     // cache des images chargées
    showSparkles: false      // active/désactive les paillettes
  };

  // -------- Utilitaires --------

  // Charge une image et la mémorise dans un cache pour éviter les rechargements
  const loadImage = src => {
    if (!src) return Promise.resolve(null);
    if (state.imgCache.has(src)) return state.imgCache.get(src);

    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Échec chargement : ${src}`));
      img.src = src;
    });

    state.imgCache.set(src, promise);
    return promise;
  };

  // Permet d'activer ou désactiver les paillettes via une checkbox
  const sparkleCheckbox = document.getElementById('sparkle-checkbox');
  sparkleCheckbox.addEventListener('change', e => {
    state.showSparkles = e.target.checked;
  });

  // Nettoie tout le canvas
  const clearRect = (c, w, h) => c.clearRect(0, 0, w, h);

  // Dessine l'image de fond ou un fond uni si échec
  const drawBackground = async (c, w, h, url) => {
    clearRect(c, w, h);
    const img = await loadImage(url);
    if (img) c.drawImage(img, 0, 0, w, h);
    else {
      c.fillStyle = '#333';
      c.fillRect(0, 0, w, h);
    }
  };

  // Ajoute un filigrane tourné au centre
  const drawWatermark = (c, w, h, text = 'PokeGenX', alpha = 0.5) => {
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-45 * Math.PI / 180);
    c.globalAlpha = alpha;
    c.font = 'bold 45px sans-serif';
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 0, 0);
    c.restore();
    c.globalAlpha = 1;
  };

  // Créé un masque arrondi pour les bords de la carte
  const clipRounded = (c, w, h, r = 12) => {
    c.save();
    c.beginPath();
    c.moveTo(r, 0);
    c.lineTo(w - r, 0);
    c.quadraticCurveTo(w, 0, w, r);
    c.lineTo(w, h - r);
    c.quadraticCurveTo(w, h, w - r, h);
    c.lineTo(r, h);
    c.quadraticCurveTo(0, h, 0, h - r);
    c.lineTo(0, r);
    c.quadraticCurveTo(0, 0, r, 0);
    c.clip();
  };

  // Fonction d'interpolation pour l'animation
  const easeInOutCubic = t =>
    t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // -------- Système de paillettes --------

  const sparkles = [];
  const MAX_SPARKLES = 60;
  const FADE_IN_RATIO = 0.1;
  const FADE_OUT_RATIO = 0.1;

  // Crée une nouvelle paillette aléatoire
  function createSparkle(w, h) {
    const ttl = 30 + Math.random() * 30;
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      size: 1 + Math.random() * 2,
      alpha: 0,
      life: Math.random() * ttl,
      ttl
    };
  }

  // Initialise le pool de paillettes
  for (let i = 0; i < MAX_SPARKLES; i++) {
    sparkles.push(createSparkle(VIEW.w, VIEW.h));
  }

  // Met à jour la transparence et la durée de vie
  function updateSparkles() {
    for (const s of sparkles) {
      s.life++;
      const fadeInEnd = s.ttl * FADE_IN_RATIO;
      const fadeOutStart = s.ttl * (1 - FADE_OUT_RATIO);

      if (s.life < fadeInEnd) {
        s.alpha = s.life / fadeInEnd;
      } else if (s.life > fadeOutStart) {
        s.alpha = 1 - (s.life - fadeOutStart) / (s.ttl * FADE_OUT_RATIO);
      } else {
        s.alpha = 1;
      }

      if (s.life >= s.ttl) {
        Object.assign(s, createSparkle(VIEW.w, VIEW.h));
      }
    }
  }

  // Dessine chaque paillette en mode 'lighter'
  function drawSparkles(c) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const s of sparkles) {
      c.globalAlpha = s.alpha * 0.6;
      c.strokeStyle = '#fff';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(s.x, s.y - s.size);
      c.lineTo(s.x, s.y + s.size);
      c.moveTo(s.x - s.size, s.y);
      c.lineTo(s.x + s.size, s.y);
      c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  // Lance la mise à jour et le dessin des paillettes si activé
  function maybeSparkle(c) {
    if (!state.showSparkles) return;
    updateSparkles();
    drawSparkles(c);
  }

  // -------- Dessins recto / verso --------

  // Dessine le verso de la carte
  const drawBack = async (c, w, h, cfg) => {
    await drawBackground(c, w, h, cfg.bgUrl);
    const txt =
      (document.getElementById('filigrane')?.value || '')
        .trim()
        .substring(0, 8) || 'PokeGenX';
    drawWatermark(c, w, h, txt, 0.5);
    maybeSparkle(c);
  };

  // Dessine le recto de la carte
  const drawFront = async (c, w, h, cfg) => {
    await drawBackground(c, w, h, cfg.bgUrl);

    // En-tête avec nom et PV
    clipRounded(c, w, h);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, 0, w, 32);
    c.fillStyle = '#fff';
    c.font = 'bold 14px sans-serif';
    c.textBaseline = 'middle';
    const nameCustom = document.getElementById('customname')?.value.trim();
    const title = (nameCustom || cfg.name).toUpperCase();
    c.fillText(title, 12, 16);
    if (cfg.hp) {
      const txtHp = `Pv ${cfg.hp}`;
      const wTxt = c.measureText(txtHp).width;
      c.fillText(txtHp, w - wTxt - 12, 16);
    }

    // Catégorie
    if (cfg.category) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0, 32, w, 24);
      c.fillStyle = '#fff';
      c.font = '12px sans-serif';
      c.fillText(cfg.category, 12, 44);
    }

    // Icônes de types
    let x = 12;
    for (const t of cfg.types) {
      const imgT = await loadImage(t.image);
      if (imgT) c.drawImage(imgT, x, 60, 20, 20);
      x += 24;
    }

    // Sprite du Pokémon
    let sprite = null;
    if (cfg.spriteUrl) {
      try {
        sprite = await loadImage(cfg.spriteUrl);
      } catch {
        console.warn('Sprite KO', cfg.spriteUrl);
      }
    }
    let usedScale = 1;
    if (sprite) {
      const maxW = w * 0.8;
      const scale = maxW / sprite.width;
      usedScale = scale;
      const sw = sprite.width * scale;
      const sh = sprite.height * scale;
      c.drawImage(sprite, (w - sw) / 2, 90, sw, sh);
    }

    // Informations supplémentaires : taille, poids, stats, numéro
    const dimY = 90 + (sprite ? sprite.height * usedScale : 0) + 16;
    const topY = dimY - 12;
    const bottomY = h - 32;
    const heightWeight = `Taille : ${cfg.heightTxt} - Poids : ${cfg.weightTxt}`;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, topY, w, bottomY + 32 - topY);
    c.fillStyle = '#fff';
    c.font = '12px sans-serif';
    c.textAlign = 'center';
    c.fillText(heightWeight, w / 2, dimY);
    c.textAlign = 'start';

    const stats = [];
    cfg.atk && stats.push(`ATK ${cfg.atk}`);
    cfg.def && stats.push(`DEF ${cfg.def}`);
    cfg.vit && stats.push(`VIT ${cfg.vit}`);
    c.fillText(stats.join(' - '), 12, bottomY + 16);

    if (cfg.id) {
      const idTxt = `N°${cfg.id}`;
      const wId = c.measureText(idTxt).width;
      c.fillText(idTxt, w - wId - 12, bottomY + 16);
    }

    c.restore();
    maybeSparkle(c);
  };

  // Sélectionne la face à dessiner selon l'état
  const renderFace = (c, w, h, cfg) =>
    state.isBack
      ? drawBack(c, w, h, cfg)
      : drawFront(c, w, h, cfg);

  // -------- Animation de flip --------
  const flipCard = (duration = 2000) => {
    if (!state.config || state.isFlipping) return;
    state.isFlipping = true;
    const start = performance.now();
    let swapped = false;

    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const half = 0.5;
      let alpha;

      if (t < half) {
        alpha = 1 - easeInOutCubic(t / half);
      } else {
        if (!swapped) {
          state.isBack = !state.isBack;
          swapped = true;
        }
        alpha = easeInOutCubic((t - half) / half);
      }

      ctx.save();
      clearRect(ctx, VIEW.w, VIEW.h);
      ctx.globalAlpha = alpha;
      renderFace(ctx, VIEW.w, VIEW.h, state.config);
      ctx.restore();
      maybeSparkle(ctx);

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        renderFace(ctx, VIEW.w, VIEW.h, state.config).then(() => {
          maybeSparkle(ctx);
          state.isFlipping = false;
        });
      }
    };

    requestAnimationFrame(step);
  };

  // -------- Génération de la carte --------
  // Crée la configuration puis dessine directement la face avant
  async function generate() {
    const pIdx = +document.getElementById('pokemon-select').value;
    const bIdx = +document.getElementById('background-select').value;
    if (isNaN(pIdx)) return;

    const p = window.pokemons[pIdx];
    const bgNum = bIdx >= 0 ? bIdx + 1 : 1;
    const shiny = document.getElementById('shiny-checkbox').checked;
    const sprite = shiny ? p.sprites.shiny || p.sprites.regular : p.sprites.regular;

    state.config = {
      bgUrl: `https://raw.githubusercontent.com/PokeGenX-com/background/main/${bgNum}.jpg`,
      spriteUrl: sprite,
      name: p.name.fr,
      hp: p.stats.hp,
      category: p.category,
      types: p.types,
      heightTxt: p.height,
      weightTxt: p.weight,
      atk: p.stats.atk,
      def: p.stats.def,
      vit: p.stats.vit,
      id: p.pokedex_id
    };
    state.isBack = false;

    await drawFront(ctx, VIEW.w, VIEW.h, state.config);
    maybeSparkle(ctx);
    canvas.classList.remove('placeholder');
  }

  // -------- Export haute-résolution --------

  // Calcule un scale optimal pour un export à 300 DPI
  const computeExportScale = async cfg => {
    const target = 300 / 96;
    let maxScale = Infinity;
    try {
      const img = await loadImage(cfg.bgUrl);
      maxScale = Math.min(img.width / VIEW.w, img.height / VIEW.h);
    } catch {}
    const scale = Math.max(1, Math.min(target, maxScale));
    return { scale, dpi: 96 * scale };
  };

  // Renvoie un Blob image PNG du canvas redessiné en haute résolution
  const renderHighRes = async (cfg, back) => {
    const { scale } = await computeExportScale(cfg);
    const W = Math.round(VIEW.w * scale);
    const H = Math.round(VIEW.h * scale);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const c2 = off.getContext('2d', { willReadFrequently: true });
    c2.scale(scale, scale);

    if (back) await drawBack(c2, VIEW.w, VIEW.h, cfg);
    else await drawFront(c2, VIEW.w, VIEW.h, cfg);

    return new Promise(res =>
      off.toBlob(blob => res({ blob, W, H }), 'image/png')
    );
  };

  // Télécharge un Blob en simulant un lien
  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  // Télécharge le canvas actuel (taille écran)
  const downloadCanvas = async () => {
    canvas.toBlob(blob => {
      if (blob) downloadBlob(blob, 'pokemon-card.png');
      else console.error('Blob canvas manquant');
    }, 'image/png');
  };

  // Télécharge la carte en haute résolution
  const downloadHD = async () => {
    if (!state.config) return;
    const { blob, W, H } = await renderHighRes(state.config, state.isBack);
    if (blob) {
      const base = (state.config.name || 'pokemon-card').replace(/\W+/g, '_');
      downloadBlob(blob, `${base}-${W}x${H}.png`);
    } else {
      alert('Erreur création HD');
    }
  };

  // -------- GIF animé --------

  // Génère un GIF qui bascule recto/verso
  const downloadGif = async () => {
    if (!state.config) {
      alert('Génère d’abord une carte pour le GIF');
      return;
    }
    const { scale } = await computeExportScale(state.config);
    const W = Math.round(VIEW.w * scale);
    const H = Math.round(VIEW.h * scale);
    const cF = document.createElement('canvas');
    const cB = document.createElement('canvas');
    [cF, cB].forEach(c => {
      c.width = W;
      c.height = H;
    });
    const fCtx = cF.getContext('2d', { willReadFrequently: true });
    const bCtx = cB.getContext('2d', { willReadFrequently: true });
    fCtx.scale(scale, scale);
    bCtx.scale(scale, scale);

    await drawFront(fCtx, VIEW.w, VIEW.h, state.config);
    await drawBack(bCtx, VIEW.w, VIEW.h, state.config);

    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: W,
      height: H,
      repeat: 0,
      workerScript: 'assets/js/gif.worker.js'
    });

    gif.addFrame(cF, { delay: 1500, copy: true });
    gif.addFrame(cB, { delay: 1500, copy: true });
    gif.on('finished', blob => downloadBlob(blob, 'pokemon-card.gif'));
    gif.render();
  };

  // -------- Événements UI --------

  // Flip au clic
  canvas.addEventListener('click', () => flipCard(150));

  // Menu d'actions : générer, random, télécharger, HD, GIF
  document.getElementById('action-select')
    .addEventListener('change', async e => {
      if (!e.isTrusted) return;
      switch (e.target.selectedIndex) {
        case 1:
          await generate();
          break;
        case 2:
          document.getElementById('pokemon-select').value =
            Math.floor(Math.random() * window.pokemons.length);
          document.getElementById('background-select').value =
            Math.floor(Math.random() * window.backgrounds.length);
          await generate();
          break;
        case 3:
          await downloadCanvas();
          break;
        case 4:
          await downloadHD();
          break;
        case 5:
          await downloadGif();
          break;
      }
      e.target.selectedIndex = 0;
    });

  // -------- Initialisation --------
  (async () => {
    await initData();
    // Affiche une face arrière par défaut en attendant la première génération
    await drawBack(ctx, VIEW.w, VIEW.h, {
      bgUrl: '/assets/images/card-background.jpg'
    });
  })();

});
