import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
/** A finite, two-pass contact-occlusion bake. Every offscreen resource has an owner. */
export default function StudioContact() {
  const plane = useRef<Mesh>(null),
    done = useRef(false);
  const { scene, gl, invalidate } = useThree();
  const resources = useMemo(() => {
    const target = new WebGLRenderTarget(512, 512),
      scratch = new WebGLRenderTarget(512, 512);
    target.texture.generateMipmaps = scratch.texture.generateMipmaps = false;
    const camera = new OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.001, 0.24);
    camera.position.set(0.08, 0.235, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0.08, -0.005, 0);
    camera.updateMatrixWorld();
    const depth = new ShaderMaterial({
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:
        'void main(){float a=pow(clamp(gl_FragCoord.z,0.0,1.0),4.0);gl_FragColor=vec4(0.0,0.0,0.0,a);}',
    });
    const blur = new ShaderMaterial({
      uniforms: { image: { value: target.texture }, step: { value: new Vector2(2 / 512, 0) } },
      vertexShader: 'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:
        'varying vec2 uv0;uniform sampler2D image;uniform vec2 step;void main(){vec4 c=texture2D(image,uv0)*0.227027;c+=(texture2D(image,uv0+step*1.384615)+texture2D(image,uv0-step*1.384615))*0.316216;c+=(texture2D(image,uv0+step*3.230769)+texture2D(image,uv0-step*3.230769))*0.070270;gl_FragColor=c;}',
    });
    const quadGeometry = new PlaneGeometry(2, 2),
      quad = new Mesh(quadGeometry, blur),
      blurScene = new Scene();
    blurScene.add(quad);
    return { target, scratch, camera, depth, blur, quadGeometry, blurScene };
  }, []);
  useEffect(
    () => () => {
      resources.target.dispose();
      resources.scratch.dispose();
      resources.depth.dispose();
      resources.blur.dispose();
      resources.quadGeometry.dispose();
    },
    [resources],
  );
  useFrame(() => {
    if (done.current || !plane.current) return;
    done.current = true;
    const background = scene.background,
      override = scene.overrideMaterial,
      previousTarget = gl.getRenderTarget(),
      color = gl.getClearColor(new Color()),
      alpha = gl.getClearAlpha(),
      shadowAuto = gl.shadowMap.autoUpdate;
    // The ground receives lighting shadows separately. It must not occlude the bake.
    const receivers: Mesh[] = [];
    scene.traverse((o) => {
      if (
        o instanceof Mesh &&
        o.material &&
        !Array.isArray(o.material) &&
        o.material.type === 'ShadowMaterial'
      ) {
        receivers.push(o);
        o.visible = false;
      }
    });
    plane.current.visible = false;
    scene.background = null;
    scene.overrideMaterial = resources.depth;
    gl.shadowMap.autoUpdate = false;
    gl.setClearColor(0, 0);
    gl.setRenderTarget(resources.target);
    gl.clear();
    gl.render(scene, resources.camera);
    scene.overrideMaterial = override;
    scene.background = background;
    resources.blur.uniforms.image!.value = resources.target.texture;
    resources.blur.uniforms.step!.value.set(2 / 512, 0);
    gl.setRenderTarget(resources.scratch);
    gl.clear();
    gl.render(resources.blurScene, resources.camera);
    resources.blur.uniforms.image!.value = resources.scratch.texture;
    resources.blur.uniforms.step!.value.set(0, 2 / 512);
    gl.setRenderTarget(resources.target);
    gl.clear();
    gl.render(resources.blurScene, resources.camera);
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(color, alpha);
    gl.shadowMap.autoUpdate = shadowAuto;
    receivers.forEach((o) => {
      o.visible = true;
    });
    plane.current.visible = true;
    invalidate();
  });
  return (
    <mesh
      ref={plane}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0.08, -0.0035, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[1.2, 1.2]} />
      <meshBasicMaterial
        map={resources.target.texture}
        transparent
        opacity={0.32}
        depthWrite={false}
      />
    </mesh>
  );
}
