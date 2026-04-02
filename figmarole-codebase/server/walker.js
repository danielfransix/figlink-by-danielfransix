'use strict';

// DOM walker — injected via CDP Runtime.evaluate.
// Returns a JSON string of the full node tree + metadata.

const WALKER_SCRIPT = `(function figmaroleWalker() {
  const MAX_DEPTH = 35;
  const SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD',
    'TITLE','BASE','TEMPLATE','IFRAME'
  ]);
  // Elements whose children are considered inline (part of a text leaf)
  const INLINE_TAGS = new Set([
    'SPAN','A','STRONG','EM','B','I','ABBR','CODE','S','U',
    'SMALL','SUP','SUB','CITE','KBD','MARK','Q','VAR','WBR',
    'TIME','DATA','BDI','BDO'
  ]);

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  }

  function getNodeName(el) {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    if (aria && aria.trim()) return aria.trim().slice(0, 50);
    const alt  = el.getAttribute('alt');
    if (alt  && alt.trim())  return alt.trim().slice(0, 50);
    const id   = el.id ? '#' + el.id : '';
    const cls  = (typeof el.className === 'string')
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + c).join('')
      : '';
    return (el.tagName.toLowerCase() + (id || cls)).slice(0, 50);
  }

  function getStyles(el) {
    const s = window.getComputedStyle(el);
    return {
      display:      s.display,
      visibility:   s.visibility,
      opacity:      s.opacity,
      overflow:     s.overflow,
      overflowX:    s.overflowX,
      overflowY:    s.overflowY,
      // background
      bg:           s.backgroundColor,
      bgImage:      s.backgroundImage,
      bgSize:       s.backgroundSize,
      bgPosition:   s.backgroundPosition,
      bgRepeat:     s.backgroundRepeat,
      // text
      color:          s.color,
      fontSize:       s.fontSize,
      fontFamily:     s.fontFamily,
      fontWeight:     s.fontWeight,
      fontStyle:      s.fontStyle,
      lineHeight:     s.lineHeight,
      letterSpacing:  s.letterSpacing,
      textAlign:      s.textAlign,
      textDecoration: s.textDecorationLine || s.textDecoration,
      textTransform:  s.textTransform,
      whiteSpace:     s.whiteSpace,
      // border radius
      brTL: s.borderTopLeftRadius,
      brTR: s.borderTopRightRadius,
      brBL: s.borderBottomLeftRadius,
      brBR: s.borderBottomRightRadius,
      // border — per side
      bTopStyle:    s.borderTopStyle,    bTopWidth:    s.borderTopWidth,    bTopColor:    s.borderTopColor,
      bRightStyle:  s.borderRightStyle,  bRightWidth:  s.borderRightWidth,  bRightColor:  s.borderRightColor,
      bBottomStyle: s.borderBottomStyle, bBottomWidth: s.borderBottomWidth, bBottomColor: s.borderBottomColor,
      bLeftStyle:   s.borderLeftStyle,   bLeftWidth:   s.borderLeftWidth,   bLeftColor:   s.borderLeftColor,
      // outline (used as a focus ring / border substitute)
      outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor,
      // effects
      boxShadow:      s.boxShadow,
      filter:         s.filter,
      backdropFilter: s.backdropFilter,
      mixBlendMode:   s.mixBlendMode,
      // layout
      objectFit:      s.objectFit,
      objectPosition: s.objectPosition,
      // flex container
      flexDirection:  s.flexDirection,
      flexWrap:       s.flexWrap,
      justifyContent: s.justifyContent,
      alignItems:     s.alignItems,
      alignContent:   s.alignContent,
      gap:            s.gap,
      rowGap:         s.rowGap,
      columnGap:      s.columnGap,
      // padding
      paddingTop:    s.paddingTop,
      paddingRight:  s.paddingRight,
      paddingBottom: s.paddingBottom,
      paddingLeft:   s.paddingLeft,
      // margin (used to compute gaps between siblings)
      marginTop:    s.marginTop,
      marginRight:  s.marginRight,
      marginBottom: s.marginBottom,
      marginLeft:   s.marginLeft,
      // flex child
      flexGrow:   s.flexGrow,
      flexShrink: s.flexShrink,
      flexBasis:  s.flexBasis,
      alignSelf:  s.alignSelf,
      order:      s.order,
      // grid container
      gridTemplateColumns: s.gridTemplateColumns,
      gridTemplateRows:    s.gridTemplateRows,
      gridAutoFlow:        s.gridAutoFlow,
      // sizing
      width:     s.width,
      height:    s.height,
      minWidth:  s.minWidth,
      maxWidth:  s.maxWidth,
      minHeight: s.minHeight,
      maxHeight: s.maxHeight,
      // positioning
      position: s.position,
      top:      s.top,
      right:    s.right,
      bottom:   s.bottom,
      left:     s.left,
      zIndex:   s.zIndex,
      transform: s.transform !== 'none' ? s.transform : null,
    };
  }

  // True when all element-children are inline → treat this element as a text leaf
  function isTextLeaf(el) {
    if (!el.textContent.trim()) return false;
    for (const child of el.children) {
      if (!INLINE_TAGS.has(child.tagName)) return false;
    }
    return true;
  }

  function captureNode(el, depth) {
    if (depth > MAX_DEPTH) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const styles = getStyles(el);
    if (styles.display === 'none' || styles.visibility === 'hidden') return null;
    if (parseFloat(styles.opacity) === 0) return null;

    const rect = getRect(el);
    if (rect.w === 0 && rect.h === 0) return null;

    const tag   = el.tagName.toLowerCase();
    const isImg = tag === 'img';
    const isSvg = tag === 'svg';

    // A text leaf renders as a Figma text node (no element children worth descending into)
    const couldBeTextLeaf = !isImg && !isSvg && isTextLeaf(el);

    // Elements with significant visual box styling → render as a frame wrapper + inner text
    // so we don't lose background / border-radius / shadow on buttons, pills, badges, etc.
    const hasVisualBox = (function() {
      if (!couldBeTextLeaf) return false;
      const bg  = styles.bg;
      const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const hasBorder =
        (styles.bTopWidth   && parseFloat(styles.bTopWidth)    > 0 && styles.bTopStyle    !== 'none') ||
        (styles.bRightWidth && parseFloat(styles.bRightWidth)  > 0 && styles.bRightStyle  !== 'none') ||
        (styles.bBottomWidth&& parseFloat(styles.bBottomWidth) > 0 && styles.bBottomStyle !== 'none') ||
        (styles.bLeftWidth  && parseFloat(styles.bLeftWidth)   > 0 && styles.bLeftStyle   !== 'none');
      const hasBr =
        parseFloat(styles.brTL) > 0 || parseFloat(styles.brTR) > 0 ||
        parseFloat(styles.brBL) > 0 || parseFloat(styles.brBR) > 0;
      const hasShadow = styles.boxShadow && styles.boxShadow !== 'none';
      const hasBgImg  = styles.bgImage   && styles.bgImage   !== 'none';
      return hasBg || hasBorder || hasBr || hasShadow || hasBgImg;
    })();

    // isText = pure text node (no visual box wrapping needed)
    // isTextInBox = text inside a visual container (render as frame + text child)
    const isText      = couldBeTextLeaf && !hasVisualBox;
    const isTextInBox = couldBeTextLeaf &&  hasVisualBox;

    const node = {
      tag,
      name:             getNodeName(el),
      rect,
      styles,
      isText,
      isTextInBox,
      text:             (isText || isTextInBox) ? (el.innerText || el.textContent || '').trim() : null,
      src:              isImg ? (el.currentSrc || el.src) : null,
      alt:              isImg ? (el.alt || '') : null,
      href:             tag === 'a' ? (el.href || null) : null,
      svgContent:       isSvg ? el.outerHTML : null,
      children:         [],
    };

    if (!isText && !isTextInBox && !isImg && !isSvg && el.children.length > 0) {
      for (const child of el.children) {
        const cn = captureNode(child, depth + 1);
        if (cn) node.children.push(cn);
      }
      // Respect z-index stacking order (higher z-index rendered last = on top in Figma)
      node.children.sort((a, b) => {
        const za = parseInt(a.styles.zIndex, 10) || 0;
        const zb = parseInt(b.styles.zIndex, 10) || 0;
        return za - zb;
      });
    }

    return node;
  }

  try {
    const root = document.body || document.documentElement;
    const tree = captureNode(root, 0);
    return JSON.stringify({
      ok:       true,
      title:    document.title || '',
      url:      window.location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      tree,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message });
  }
})()`;

module.exports = WALKER_SCRIPT;
