import { NAMES } from './glint-common.js';

// One game input per phone. Held results retain a target briefly but never
// create a new acquisition. No optical/contact coordinates are invented.
export class GlintInput extends EventTarget {
  constructor({ now = Date.now, timeoutMs = 450 } = {}) {
    super();
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.targets = new Map();
  }
  emit(type, deviceId, objectId, reason = '') {
    this.dispatchEvent(new CustomEvent(type, { detail: Object.freeze({ deviceId, objectId, name: NAMES[objectId], reason }) }));
  }
  update(result) {
    const previous = this.targets.get(result.id);
    if (!Number.isFinite(result.at) || this.now() - result.at > this.timeoutMs) return;
    if (previous && result.epoch !== undefined && previous.epoch !== undefined && result.epoch !== previous.epoch) this.release(result.id, 'カメラを再取得しました');
    const current = this.targets.get(result.id);
    if (result.valid && Number.isInteger(result.object) && NAMES[result.object]) {
      if (current && current.object !== result.object) this.release(result.id, '対象が変わりました');
      this.targets.set(result.id, { object: result.object, at: result.at, epoch: result.epoch });
      if (!current || current.object !== result.object) this.emit('acquired', result.id, result.object);
    } else if (!result.held || !current || result.object !== current.object) this.release(result.id, result.reason || '信号が途切れました');
  }
  release(deviceId, reason) {
    const current = this.targets.get(deviceId);
    if (!current) return;
    this.targets.delete(deviceId);
    this.emit('released', deviceId, current.object, reason);
  }
  expire() {
    for (const [id, target] of this.targets) if (this.now() - target.at > this.timeoutMs) this.release(id, '判定が届いていません');
  }
  clear(reason = '表示をリセットしました') {
    for (const id of this.targets.keys()) this.release(id, reason);
  }
}
