import { Canvas } from "@react-three/fiber";

// R3F reads `data-src` as the nested path `obj.data.src` and can throw, so the loader skips this file.
export function Scene() {
  return (
    <Canvas>
      <mesh>
        <boxGeometry />
      </mesh>
    </Canvas>
  );
}
