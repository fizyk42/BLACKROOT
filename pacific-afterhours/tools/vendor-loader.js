export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return {url: new URL('../client/vendor/three/three.module.js', import.meta.url).href, shortCircuit: true};
  if (specifier.startsWith('three/addons/')) return {url: new URL('../client/vendor/three/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true};
  return nextResolve(specifier, context);
}
