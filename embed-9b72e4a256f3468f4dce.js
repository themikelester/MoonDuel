!function(e){var t={};function n(i){if(t[i])return t[i].exports;var s=t[i]={i:i,l:!1,exports:{}};return e[i].call(s.exports,s,s.exports,n),s.l=!0,s.exports}n.m=e,n.c=t,n.d=function(e,t,i){n.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:i})},n.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},n.t=function(e,t){if(1&t&&(e=n(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var i=Object.create(null);if(n.r(i),Object.defineProperty(i,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var s in e)n.d(i,s,function(t){return e[t]}.bind(null,s));return i},n.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return n.d(t,"a",t),t},n.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},n.p="",n(n.s=16)}({16:function(e,t,n){"use strict";class i{constructor(){this.hover=!1,this.elem=document.createElement("div"),this.elem.style.border="1px solid rgba(255, 255, 255, 0.4)",this.elem.style.borderRadius="4px",this.elem.style.color="white",this.elem.style.position="absolute",this.elem.style.bottom="8px",this.elem.style.right="8px",this.elem.style.width="32px",this.elem.style.height="32px",this.elem.style.font="130% bold sans-serif",this.elem.style.textAlign="center",this.elem.style.cursor="pointer",this.elem.onmouseover=()=>{this.hover=!0,this.style()},this.elem.onmouseout=()=>{this.hover=!1,this.style()},this.elem.onclick=this.onClick.bind(this),document.addEventListener("fullscreenchange",this.style.bind(this)),this.style()}isFS(){return document.fullscreenElement===document.body}style(){this.elem.style.backgroundColor=this.hover?"rgba(50, 50, 50, 0.8)":"rgba(0, 0, 0, 0.8)",this.elem.textContent=this.isFS()?"🡼":"🡾"}onClick(){this.isFS()?document.exitFullscreen():document.body.requestFullscreen()}}window.main=new class{constructor(){this._updateLoop=e=>{window.requestAnimationFrame(this._updateLoop)},this.init()}async init(){this.canvas=document.createElement("canvas"),this.toplevel=document.createElement("div"),document.body.appendChild(this.toplevel),this.toplevel.appendChild(this.canvas),window.onresize=this.onResize.bind(this),this.fsButton=new i,this.toplevel.appendChild(this.fsButton.elem),this.sceneUIContainer=document.createElement("div"),this.sceneUIContainer.style.pointerEvents="none",this.sceneUIContainer.style.position="absolute",this.sceneUIContainer.style.top="0",this.sceneUIContainer.style.left="0",this.toplevel.appendChild(this.sceneUIContainer),this.onResize(),this._updateLoop(0)}onResize(){const e=window.devicePixelRatio||1;this.canvas.width=Math.ceil(window.innerWidth*e),this.canvas.height=Math.ceil(window.innerHeight*e)}}}});