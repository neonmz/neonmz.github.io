export class AsyncCondition {
  private _resolves: Array<() => void> = [];
  private _rejects: Array<(reason: Error) => void> = [];
  private _flag = false;
  private _error: Error | null = null;
  private _path = "";
  private _cb: (() => void) | undefined; 

  wait(path: string): Promise<void> {
    if (!this._path) this._path = path;
    else (this.reset(path));

    if (this._flag) {
      return Promise.resolve();
    }
    if (this._error) {
      return Promise.reject(this._error);
    }

    return new Promise<void>((resolve, reject) => {
      this._resolves.push(resolve);
      this._rejects.push(reject);
    });
  }

  notify(): void {
    this._flag = true;
    this._resolves.forEach(r => void(r()));
    this._resolves = [];
    this._rejects = [];
  }

  reject(reason: Error): void {
    this._error = reason;
    this._rejects.forEach(r => void(r(reason)));
    this._rejects = [];
    this._resolves = [];
  }

  reset(path : string): void {
    if (path === this._path) return;
    this.reject(new Error("Page changed"));
    this._flag = false;
    this._error = null;
    //this._resolves = [];
    // this._rejects = [];
    this._path = "";
    if (this._cb) this._cb();
  }
  
  setResetCallback(cb: () => void): void {
    this._cb = cb;
  }
}