"""Does strong drive leave the network in a self-sustaining state once the stimulus stops?"""
import sys, numpy as np
sys.path.insert(0, 'pipeline')
import validate_lif as V
N = V.N
def run(phases, adapt=None, seed=0):
    rng = np.random.default_rng(seed)
    v = np.full(N, V.v0, np.float32); g = np.zeros(N, np.float32); ref = np.zeros(N, np.float32); th = np.zeros(N, np.float32)
    ring = [np.zeros(N, np.float32) for _ in range(V.delay_steps)]
    out = []; s = 0
    for (name, idx, rate, T) in phases:
        idx = np.asarray(idx); p = rate * V.dt / 1000; counts = np.zeros(N, np.int64)
        for _ in range(int(T / V.dt)):
            sp_in = ring[s % V.delay_steps]; g += V.WT @ sp_in * V.w_syn; ring[s % V.delay_steps] = np.zeros(N, np.float32)
            if rate > 0:
                kick = idx[rng.random(len(idx)) < p]; g[kick] += V.w_syn * V.P['poisson_gain']
            active = ref <= 0
            v[active] += V.dt * ((V.v0 - v[active] + g[active]) / V.tau_m); g -= V.dt * g / V.tau_s; ref -= V.dt
            fired = (v > V.vth + th) & active
            v[fired] = V.v0; g[fired] = 0; ref[fired] = V.t_ref; counts[fired] += 1
            if adapt: th[fired] += adapt[0]; th *= np.exp(-V.dt / adapt[1])
            ring[(s + V.delay_steps) % V.delay_steps][fired] = 1.0; s += 1
        out.append((name, int(counts.sum()), int((counts > 0).sum())))
    return out
G = V.groups
r8 = [i for i in G['R8']][:660]
if __name__ == '__main__':
  for adapt in [None, (0.5, 300.0)]:
    print('adapt', adapt)
    print(' R8 60Hz then off :', run([('R8 on', r8, 60, 1000), ('off', r8, 0, 1000), ('off2', r8, 0, 1000)], adapt))
    print(' sugar+PPL1 then off:', run([('on', np.concatenate([G['sugar'], G['PPL1'], G['bitter']]), 120, 1000), ('off', r8, 0, 1000)], adapt))
    print(' ORN_DA1 then off :', run([('on', G['ORN_DA1'], 60, 1000), ('off', r8, 0, 1000)], adapt))
    print(' JO-B 150 then off:', run([('on', G['JO-B'], 150, 1000), ('off', r8, 0, 1000)], adapt))
