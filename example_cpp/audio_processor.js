async function createModule(moduleArg = {}) {
  var moduleRtn;
  var Module = moduleArg;
  var ENVIRONMENT_IS_WEB = true;
  var ENVIRONMENT_IS_WORKER = false;
  var ENVIRONMENT_IS_NODE = false;
  var ENVIRONMENT_IS_SHELL = false;
  var arguments_ = [];
  var thisProgram = './this.program';
  var quit_ = (status, toThrow) => {
    throw toThrow;
  };
  var _scriptName = import.meta.url;
  var scriptDirectory = '';
  function locateFile(path) {
    if (Module['locateFile']) {
      return Module['locateFile'](path, scriptDirectory);
    }
    return scriptDirectory + path;
  }
  var readAsync, readBinary;
  if (ENVIRONMENT_IS_SHELL) {
    const isNode =
      typeof process == 'object' && process.versions?.node && process.type != 'renderer';
    if (isNode || typeof window == 'object' || typeof WorkerGlobalScope != 'undefined')
      throw new Error(
        'not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)'
      );
  } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    try {
      scriptDirectory = new URL('.', _scriptName).href;
    } catch {}
    if (!(typeof window == 'object' || typeof WorkerGlobalScope != 'undefined'))
      throw new Error(
        'not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)'
      );
    {
      readAsync = async url => {
        assert(!isFileURI(url), 'readAsync does not work with file:// URLs');
        var response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok) {
          return response.arrayBuffer();
        }
        throw new Error(response.status + ' : ' + response.url);
      };
    }
  } else {
    throw new Error('environment detection error');
  }
  var out = console.log.bind(console);
  var err = console.error.bind(console);
  assert(
    !ENVIRONMENT_IS_WORKER,
    'worker environment detected but not enabled at build time.  Add `worker` to `-sENVIRONMENT` to enable.'
  );
  assert(
    !ENVIRONMENT_IS_NODE,
    'node environment detected but not enabled at build time.  Add `node` to `-sENVIRONMENT` to enable.'
  );
  assert(
    !ENVIRONMENT_IS_SHELL,
    'shell environment detected but not enabled at build time.  Add `shell` to `-sENVIRONMENT` to enable.'
  );
  var wasmBinary;
  if (typeof WebAssembly != 'object') {
    err('no native wasm support detected');
  }
  var ABORT = false;
  var EXITSTATUS;
  function assert(condition, text) {
    if (!condition) {
      abort('Assertion failed' + (text ? ': ' + text : ''));
    }
  }
  var isFileURI = filename => filename.startsWith('file://');
  function writeStackCookie() {
    var max = _emscripten_stack_get_end();
    assert((max & 3) == 0);
    if (max == 0) {
      max += 4;
    }
    HEAPU32[max >> 2] = 34821223;
    HEAPU32[(max + 4) >> 2] = 2310721022;
    HEAPU32[0 >> 2] = 1668509029;
  }
  function checkStackCookie() {
    if (ABORT) return;
    var max = _emscripten_stack_get_end();
    if (max == 0) {
      max += 4;
    }
    var cookie1 = HEAPU32[max >> 2];
    var cookie2 = HEAPU32[(max + 4) >> 2];
    if (cookie1 != 34821223 || cookie2 != 2310721022) {
      abort(
        `Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${ptrToString(cookie2)} ${ptrToString(cookie1)}`
      );
    }
    if (HEAPU32[0 >> 2] != 1668509029) {
      abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
    }
  }
  var runtimeDebug = true;
  (() => {
    var h16 = new Int16Array(1);
    var h8 = new Int8Array(h16.buffer);
    h16[0] = 25459;
    if (h8[0] !== 115 || h8[1] !== 99)
      throw 'Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)';
  })();
  function consumedModuleProp(prop) {
    if (!Object.getOwnPropertyDescriptor(Module, prop)) {
      Object.defineProperty(Module, prop, {
        configurable: true,
        set() {
          abort(
            `Attempt to set \`Module.${prop}\` after it has already been processed.  This can happen, for example, when code is injected via '--post-js' rather than '--pre-js'`
          );
        },
      });
    }
  }
  function makeInvalidEarlyAccess(name) {
    return () =>
      assert(false, `call to '${name}' via reference taken before Wasm module initialization`);
  }
  function ignoredModuleProp(prop) {
    if (Object.getOwnPropertyDescriptor(Module, prop)) {
      abort(
        `\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`
      );
    }
  }
  function isExportedByForceFilesystem(name) {
    return (
      name === 'FS_createPath' ||
      name === 'FS_createDataFile' ||
      name === 'FS_createPreloadedFile' ||
      name === 'FS_unlink' ||
      name === 'addRunDependency' ||
      name === 'FS_createLazyFile' ||
      name === 'FS_createDevice' ||
      name === 'removeRunDependency'
    );
  }
  function hookGlobalSymbolAccess(sym, func) {
    if (typeof globalThis != 'undefined' && !Object.getOwnPropertyDescriptor(globalThis, sym)) {
      Object.defineProperty(globalThis, sym, {
        configurable: true,
        get() {
          func();
          return undefined;
        },
      });
    }
  }
  function missingGlobal(sym, msg) {
    hookGlobalSymbolAccess(sym, () => {
      warnOnce(`\`${sym}\` is not longer defined by emscripten. ${msg}`);
    });
  }
  missingGlobal('buffer', 'Please use HEAP8.buffer or wasmMemory.buffer');
  missingGlobal('asm', 'Please use wasmExports instead');
  function missingLibrarySymbol(sym) {
    hookGlobalSymbolAccess(sym, () => {
      var msg = `\`${sym}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`;
      var librarySymbol = sym;
      if (!librarySymbol.startsWith('_')) {
        librarySymbol = '$' + sym;
      }
      msg += ` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${librarySymbol}')`;
      if (isExportedByForceFilesystem(sym)) {
        msg +=
          '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
      }
      warnOnce(msg);
    });
    unexportedRuntimeSymbol(sym);
  }
  function unexportedRuntimeSymbol(sym) {
    if (!Object.getOwnPropertyDescriptor(Module, sym)) {
      Object.defineProperty(Module, sym, {
        configurable: true,
        get() {
          var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
          if (isExportedByForceFilesystem(sym)) {
            msg +=
              '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
          }
          abort(msg);
        },
      });
    }
  }
  var readyPromiseResolve, readyPromiseReject;
  var wasmMemory;
  var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  var HEAP64, HEAPU64;
  var runtimeInitialized = false;
  function updateMemoryViews() {
    var b = wasmMemory.buffer;
    HEAP8 = new Int8Array(b);
    HEAP16 = new Int16Array(b);
    HEAPU8 = new Uint8Array(b);
    HEAPU16 = new Uint16Array(b);
    HEAP32 = new Int32Array(b);
    HEAPU32 = new Uint32Array(b);
    Module['HEAPF32'] = HEAPF32 = new Float32Array(b);
    HEAPF64 = new Float64Array(b);
    HEAP64 = new BigInt64Array(b);
    HEAPU64 = new BigUint64Array(b);
  }
  assert(
    typeof Int32Array != 'undefined' &&
      typeof Float64Array !== 'undefined' &&
      Int32Array.prototype.subarray != undefined &&
      Int32Array.prototype.set != undefined,
    'JS engine does not provide full typed array support'
  );
  function preRun() {
    if (Module['preRun']) {
      if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
      while (Module['preRun'].length) {
        addOnPreRun(Module['preRun'].shift());
      }
    }
    consumedModuleProp('preRun');
    callRuntimeCallbacks(onPreRuns);
  }
  function initRuntime() {
    assert(!runtimeInitialized);
    runtimeInitialized = true;
    checkStackCookie();
    wasmExports['__wasm_call_ctors']();
  }
  function postRun() {
    checkStackCookie();
    if (Module['postRun']) {
      if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
      while (Module['postRun'].length) {
        addOnPostRun(Module['postRun'].shift());
      }
    }
    consumedModuleProp('postRun');
    callRuntimeCallbacks(onPostRuns);
  }
  var runDependencies = 0;
  var dependenciesFulfilled = null;
  var runDependencyTracking = {};
  var runDependencyWatcher = null;
  function addRunDependency(id) {
    runDependencies++;
    Module['monitorRunDependencies']?.(runDependencies);
    if (id) {
      assert(!runDependencyTracking[id]);
      runDependencyTracking[id] = 1;
      if (runDependencyWatcher === null && typeof setInterval != 'undefined') {
        runDependencyWatcher = setInterval(() => {
          if (ABORT) {
            clearInterval(runDependencyWatcher);
            runDependencyWatcher = null;
            return;
          }
          var shown = false;
          for (var dep in runDependencyTracking) {
            if (!shown) {
              shown = true;
              err('still waiting on run dependencies:');
            }
            err(`dependency: ${dep}`);
          }
          if (shown) {
            err('(end of list)');
          }
        }, 1e4);
      }
    } else {
      err('warning: run dependency added without ID');
    }
  }
  function removeRunDependency(id) {
    runDependencies--;
    Module['monitorRunDependencies']?.(runDependencies);
    if (id) {
      assert(runDependencyTracking[id]);
      delete runDependencyTracking[id];
    } else {
      err('warning: run dependency removed without ID');
    }
    if (runDependencies == 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }
      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }
  function abort(what) {
    Module['onAbort']?.(what);
    what = 'Aborted(' + what + ')';
    err(what);
    ABORT = true;
    var e = new WebAssembly.RuntimeError(what);
    readyPromiseReject?.(e);
    throw e;
  }
  var FS = {
    error() {
      abort(
        'Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with -sFORCE_FILESYSTEM'
      );
    },
    init() {
      FS.error();
    },
    createDataFile() {
      FS.error();
    },
    createPreloadedFile() {
      FS.error();
    },
    createLazyFile() {
      FS.error();
    },
    open() {
      FS.error();
    },
    mkdev() {
      FS.error();
    },
    registerDevice() {
      FS.error();
    },
    analyzePath() {
      FS.error();
    },
    ErrnoError() {
      FS.error();
    },
  };
  function createExportWrapper(name, nargs) {
    return (...args) => {
      assert(
        runtimeInitialized,
        `native function \`${name}\` called before runtime initialization`
      );
      var f = wasmExports[name];
      assert(f, `exported native function \`${name}\` not found`);
      assert(
        args.length <= nargs,
        `native function \`${name}\` called with ${args.length} args but expects ${nargs}`
      );
      return f(...args);
    };
  }
  var wasmBinaryFile;
  function findWasmBinary() {
    if (Module['locateFile']) {
      return locateFile('audio_processor.wasm');
    }
    return new URL('audio_processor.wasm', import.meta.url).href;
  }
  function getBinarySync(file) {
    if (file == wasmBinaryFile && wasmBinary) {
      return new Uint8Array(wasmBinary);
    }
    if (readBinary) {
      return readBinary(file);
    }
    throw 'both async and sync fetching of the wasm failed';
  }
  async function getWasmBinary(binaryFile) {
    if (!wasmBinary) {
      try {
        var response = await readAsync(binaryFile);
        return new Uint8Array(response);
      } catch {}
    }
    return getBinarySync(binaryFile);
  }
  async function instantiateArrayBuffer(binaryFile, imports) {
    try {
      var binary = await getWasmBinary(binaryFile);
      var instance = await WebAssembly.instantiate(binary, imports);
      return instance;
    } catch (reason) {
      err(`failed to asynchronously prepare wasm: ${reason}`);
      if (isFileURI(wasmBinaryFile)) {
        err(
          `warning: Loading from a file URI (${wasmBinaryFile}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`
        );
      }
      abort(reason);
    }
  }
  async function instantiateAsync(binary, binaryFile, imports) {
    if (!binary) {
      try {
        var response = fetch(binaryFile, { credentials: 'same-origin' });
        var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
        return instantiationResult;
      } catch (reason) {
        err(`wasm streaming compile failed: ${reason}`);
        err('falling back to ArrayBuffer instantiation');
      }
    }
    return instantiateArrayBuffer(binaryFile, imports);
  }
  function getWasmImports() {
    return { env: wasmImports, wasi_snapshot_preview1: wasmImports };
  }
  async function createWasm() {
    function receiveInstance(instance, module) {
      wasmExports = instance.exports;
      wasmMemory = wasmExports['memory'];
      assert(wasmMemory, 'memory not found in wasm exports');
      updateMemoryViews();
      wasmTable = wasmExports['__indirect_function_table'];
      assert(wasmTable, 'table not found in wasm exports');
      assignWasmExports(wasmExports);
      removeRunDependency('wasm-instantiate');
      return wasmExports;
    }
    addRunDependency('wasm-instantiate');
    var trueModule = Module;
    function receiveInstantiationResult(result) {
      assert(
        Module === trueModule,
        'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?'
      );
      trueModule = null;
      return receiveInstance(result['instance']);
    }
    var info = getWasmImports();
    if (Module['instantiateWasm']) {
      return new Promise((resolve, reject) => {
        try {
          Module['instantiateWasm'](info, (mod, inst) => {
            resolve(receiveInstance(mod, inst));
          });
        } catch (e) {
          err(`Module.instantiateWasm callback failed with error: ${e}`);
          reject(e);
        }
      });
    }
    wasmBinaryFile ??= findWasmBinary();
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    var exports = receiveInstantiationResult(result);
    return exports;
  }
  class ExitStatus {
    name = 'ExitStatus';
    constructor(status) {
      this.message = `Program terminated with exit(${status})`;
      this.status = status;
    }
  }
  var callRuntimeCallbacks = callbacks => {
    while (callbacks.length > 0) {
      callbacks.shift()(Module);
    }
  };
  var onPostRuns = [];
  var addOnPostRun = cb => onPostRuns.push(cb);
  var onPreRuns = [];
  var addOnPreRun = cb => onPreRuns.push(cb);
  var noExitRuntime = true;
  var ptrToString = ptr => {
    assert(typeof ptr === 'number');
    ptr >>>= 0;
    return '0x' + ptr.toString(16).padStart(8, '0');
  };
  var stackRestore = val => __emscripten_stack_restore(val);
  var stackSave = () => _emscripten_stack_get_current();
  var warnOnce = text => {
    warnOnce.shown ||= {};
    if (!warnOnce.shown[text]) {
      warnOnce.shown[text] = 1;
      err(text);
    }
  };
  class ExceptionInfo {
    constructor(excPtr) {
      this.excPtr = excPtr;
      this.ptr = excPtr - 24;
    }
    set_type(type) {
      HEAPU32[(this.ptr + 4) >> 2] = type;
    }
    get_type() {
      return HEAPU32[(this.ptr + 4) >> 2];
    }
    set_destructor(destructor) {
      HEAPU32[(this.ptr + 8) >> 2] = destructor;
    }
    get_destructor() {
      return HEAPU32[(this.ptr + 8) >> 2];
    }
    set_caught(caught) {
      caught = caught ? 1 : 0;
      HEAP8[this.ptr + 12] = caught;
    }
    get_caught() {
      return HEAP8[this.ptr + 12] != 0;
    }
    set_rethrown(rethrown) {
      rethrown = rethrown ? 1 : 0;
      HEAP8[this.ptr + 13] = rethrown;
    }
    get_rethrown() {
      return HEAP8[this.ptr + 13] != 0;
    }
    init(type, destructor) {
      this.set_adjusted_ptr(0);
      this.set_type(type);
      this.set_destructor(destructor);
    }
    set_adjusted_ptr(adjustedPtr) {
      HEAPU32[(this.ptr + 16) >> 2] = adjustedPtr;
    }
    get_adjusted_ptr() {
      return HEAPU32[(this.ptr + 16) >> 2];
    }
  }
  var exceptionLast = 0;
  var uncaughtExceptionCount = 0;
  var ___cxa_throw = (ptr, type, destructor) => {
    var info = new ExceptionInfo(ptr);
    info.init(type, destructor);
    exceptionLast = ptr;
    uncaughtExceptionCount++;
    assert(
      false,
      'Exception thrown, but exception catching is not enabled. Compile with -sNO_DISABLE_EXCEPTION_CATCHING or -sEXCEPTION_CATCHING_ALLOWED=[..] to catch.'
    );
  };
  var __abort_js = () => abort('native code called abort()');
  var tupleRegistrations = {};
  var runDestructors = destructors => {
    while (destructors.length) {
      var ptr = destructors.pop();
      var del = destructors.pop();
      del(ptr);
    }
  };
  function readPointer(pointer) {
    return this.fromWireType(HEAPU32[pointer >> 2]);
  }
  var awaitingDependencies = {};
  var registeredTypes = {};
  var typeDependencies = {};
  var InternalError = class InternalError extends Error {
    constructor(message) {
      super(message);
      this.name = 'InternalError';
    }
  };
  var throwInternalError = message => {
    throw new InternalError(message);
  };
  var whenDependentTypesAreResolved = (myTypes, dependentTypes, getTypeConverters) => {
    myTypes.forEach(type => (typeDependencies[type] = dependentTypes));
    function onComplete(typeConverters) {
      var myTypeConverters = getTypeConverters(typeConverters);
      if (myTypeConverters.length !== myTypes.length) {
        throwInternalError('Mismatched type converter count');
      }
      for (var i = 0; i < myTypes.length; ++i) {
        registerType(myTypes[i], myTypeConverters[i]);
      }
    }
    var typeConverters = new Array(dependentTypes.length);
    var unregisteredTypes = [];
    var registered = 0;
    dependentTypes.forEach((dt, i) => {
      if (registeredTypes.hasOwnProperty(dt)) {
        typeConverters[i] = registeredTypes[dt];
      } else {
        unregisteredTypes.push(dt);
        if (!awaitingDependencies.hasOwnProperty(dt)) {
          awaitingDependencies[dt] = [];
        }
        awaitingDependencies[dt].push(() => {
          typeConverters[i] = registeredTypes[dt];
          ++registered;
          if (registered === unregisteredTypes.length) {
            onComplete(typeConverters);
          }
        });
      }
    });
    if (0 === unregisteredTypes.length) {
      onComplete(typeConverters);
    }
  };
  var __embind_finalize_value_array = rawTupleType => {
    var reg = tupleRegistrations[rawTupleType];
    delete tupleRegistrations[rawTupleType];
    var elements = reg.elements;
    var elementsLength = elements.length;
    var elementTypes = elements
      .map(elt => elt.getterReturnType)
      .concat(elements.map(elt => elt.setterArgumentType));
    var rawConstructor = reg.rawConstructor;
    var rawDestructor = reg.rawDestructor;
    whenDependentTypesAreResolved([rawTupleType], elementTypes, elementTypes => {
      elements.forEach((elt, i) => {
        var getterReturnType = elementTypes[i];
        var getter = elt.getter;
        var getterContext = elt.getterContext;
        var setterArgumentType = elementTypes[i + elementsLength];
        var setter = elt.setter;
        var setterContext = elt.setterContext;
        elt.read = ptr => getterReturnType.fromWireType(getter(getterContext, ptr));
        elt.write = (ptr, o) => {
          var destructors = [];
          setter(setterContext, ptr, setterArgumentType.toWireType(destructors, o));
          runDestructors(destructors);
        };
      });
      return [
        {
          name: reg.name,
          fromWireType: ptr => {
            var rv = new Array(elementsLength);
            for (var i = 0; i < elementsLength; ++i) {
              rv[i] = elements[i].read(ptr);
            }
            rawDestructor(ptr);
            return rv;
          },
          toWireType: (destructors, o) => {
            if (elementsLength !== o.length) {
              throw new TypeError(
                `Incorrect number of tuple elements for ${reg.name}: expected=${elementsLength}, actual=${o.length}`
              );
            }
            var ptr = rawConstructor();
            for (var i = 0; i < elementsLength; ++i) {
              elements[i].write(ptr, o[i]);
            }
            if (destructors !== null) {
              destructors.push(rawDestructor, ptr);
            }
            return ptr;
          },
          readValueFromPointer: readPointer,
          destructorFunction: rawDestructor,
        },
      ];
    });
  };
  var structRegistrations = {};
  var __embind_finalize_value_object = structType => {
    var reg = structRegistrations[structType];
    delete structRegistrations[structType];
    var rawConstructor = reg.rawConstructor;
    var rawDestructor = reg.rawDestructor;
    var fieldRecords = reg.fields;
    var fieldTypes = fieldRecords
      .map(field => field.getterReturnType)
      .concat(fieldRecords.map(field => field.setterArgumentType));
    whenDependentTypesAreResolved([structType], fieldTypes, fieldTypes => {
      var fields = {};
      fieldRecords.forEach((field, i) => {
        var fieldName = field.fieldName;
        var getterReturnType = fieldTypes[i];
        var optional = fieldTypes[i].optional;
        var getter = field.getter;
        var getterContext = field.getterContext;
        var setterArgumentType = fieldTypes[i + fieldRecords.length];
        var setter = field.setter;
        var setterContext = field.setterContext;
        fields[fieldName] = {
          read: ptr => getterReturnType.fromWireType(getter(getterContext, ptr)),
          write: (ptr, o) => {
            var destructors = [];
            setter(setterContext, ptr, setterArgumentType.toWireType(destructors, o));
            runDestructors(destructors);
          },
          optional,
        };
      });
      return [
        {
          name: reg.name,
          fromWireType: ptr => {
            var rv = {};
            for (var i in fields) {
              rv[i] = fields[i].read(ptr);
            }
            rawDestructor(ptr);
            return rv;
          },
          toWireType: (destructors, o) => {
            for (var fieldName in fields) {
              if (!(fieldName in o) && !fields[fieldName].optional) {
                throw new TypeError(`Missing field: "${fieldName}"`);
              }
            }
            var ptr = rawConstructor();
            for (fieldName in fields) {
              fields[fieldName].write(ptr, o[fieldName]);
            }
            if (destructors !== null) {
              destructors.push(rawDestructor, ptr);
            }
            return ptr;
          },
          readValueFromPointer: readPointer,
          destructorFunction: rawDestructor,
        },
      ];
    });
  };
  var AsciiToString = ptr => {
    var str = '';
    while (1) {
      var ch = HEAPU8[ptr++];
      if (!ch) return str;
      str += String.fromCharCode(ch);
    }
  };
  var BindingError = class BindingError extends Error {
    constructor(message) {
      super(message);
      this.name = 'BindingError';
    }
  };
  var throwBindingError = message => {
    throw new BindingError(message);
  };
  function sharedRegisterType(rawType, registeredInstance, options = {}) {
    var name = registeredInstance.name;
    if (!rawType) {
      throwBindingError(`type "${name}" must have a positive integer typeid pointer`);
    }
    if (registeredTypes.hasOwnProperty(rawType)) {
      if (options.ignoreDuplicateRegistrations) {
        return;
      } else {
        throwBindingError(`Cannot register type '${name}' twice`);
      }
    }
    registeredTypes[rawType] = registeredInstance;
    delete typeDependencies[rawType];
    if (awaitingDependencies.hasOwnProperty(rawType)) {
      var callbacks = awaitingDependencies[rawType];
      delete awaitingDependencies[rawType];
      callbacks.forEach(cb => cb());
    }
  }
  function registerType(rawType, registeredInstance, options = {}) {
    return sharedRegisterType(rawType, registeredInstance, options);
  }
  var integerReadValueFromPointer = (name, width, signed) => {
    switch (width) {
      case 1:
        return signed ? pointer => HEAP8[pointer] : pointer => HEAPU8[pointer];
      case 2:
        return signed ? pointer => HEAP16[pointer >> 1] : pointer => HEAPU16[pointer >> 1];
      case 4:
        return signed ? pointer => HEAP32[pointer >> 2] : pointer => HEAPU32[pointer >> 2];
      case 8:
        return signed ? pointer => HEAP64[pointer >> 3] : pointer => HEAPU64[pointer >> 3];
      default:
        throw new TypeError(`invalid integer width (${width}): ${name}`);
    }
  };
  var embindRepr = v => {
    if (v === null) {
      return 'null';
    }
    var t = typeof v;
    if (t === 'object' || t === 'array' || t === 'function') {
      return v.toString();
    } else {
      return '' + v;
    }
  };
  var assertIntegerRange = (typeName, value, minRange, maxRange) => {
    if (value < minRange || value > maxRange) {
      throw new TypeError(
        `Passing a number "${embindRepr(value)}" from JS side to C/C++ side to an argument of type "${typeName}", which is outside the valid range [${minRange}, ${maxRange}]!`
      );
    }
  };
  var __embind_register_bigint = (primitiveType, name, size, minRange, maxRange) => {
    name = AsciiToString(name);
    const isUnsignedType = minRange === 0n;
    let fromWireType = value => value;
    if (isUnsignedType) {
      const bitSize = size * 8;
      fromWireType = value => BigInt.asUintN(bitSize, value);
      maxRange = fromWireType(maxRange);
    }
    registerType(primitiveType, {
      name,
      fromWireType,
      toWireType: (destructors, value) => {
        if (typeof value == 'number') {
          value = BigInt(value);
        } else if (typeof value != 'bigint') {
          throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${this.name}`);
        }
        assertIntegerRange(name, value, minRange, maxRange);
        return value;
      },
      readValueFromPointer: integerReadValueFromPointer(name, size, !isUnsignedType),
      destructorFunction: null,
    });
  };
  var __embind_register_bool = (rawType, name, trueValue, falseValue) => {
    name = AsciiToString(name);
    registerType(rawType, {
      name,
      fromWireType: function (wt) {
        return !!wt;
      },
      toWireType: function (destructors, o) {
        return o ? trueValue : falseValue;
      },
      readValueFromPointer: function (pointer) {
        return this.fromWireType(HEAPU8[pointer]);
      },
      destructorFunction: null,
    });
  };
  var shallowCopyInternalPointer = o => ({
    count: o.count,
    deleteScheduled: o.deleteScheduled,
    preservePointerOnDelete: o.preservePointerOnDelete,
    ptr: o.ptr,
    ptrType: o.ptrType,
    smartPtr: o.smartPtr,
    smartPtrType: o.smartPtrType,
  });
  var throwInstanceAlreadyDeleted = obj => {
    function getInstanceTypeName(handle) {
      return handle.$$.ptrType.registeredClass.name;
    }
    throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
  };
  var finalizationRegistry = false;
  var detachFinalizer = handle => {};
  var runDestructor = $$ => {
    if ($$.smartPtr) {
      $$.smartPtrType.rawDestructor($$.smartPtr);
    } else {
      $$.ptrType.registeredClass.rawDestructor($$.ptr);
    }
  };
  var releaseClassHandle = $$ => {
    $$.count.value -= 1;
    var toDelete = 0 === $$.count.value;
    if (toDelete) {
      runDestructor($$);
    }
  };
  var downcastPointer = (ptr, ptrClass, desiredClass) => {
    if (ptrClass === desiredClass) {
      return ptr;
    }
    if (undefined === desiredClass.baseClass) {
      return null;
    }
    var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
    if (rv === null) {
      return null;
    }
    return desiredClass.downcast(rv);
  };
  var registeredPointers = {};
  var registeredInstances = {};
  var getBasestPointer = (class_, ptr) => {
    if (ptr === undefined) {
      throwBindingError('ptr should not be undefined');
    }
    while (class_.baseClass) {
      ptr = class_.upcast(ptr);
      class_ = class_.baseClass;
    }
    return ptr;
  };
  var getInheritedInstance = (class_, ptr) => {
    ptr = getBasestPointer(class_, ptr);
    return registeredInstances[ptr];
  };
  var makeClassHandle = (prototype, record) => {
    if (!record.ptrType || !record.ptr) {
      throwInternalError('makeClassHandle requires ptr and ptrType');
    }
    var hasSmartPtrType = !!record.smartPtrType;
    var hasSmartPtr = !!record.smartPtr;
    if (hasSmartPtrType !== hasSmartPtr) {
      throwInternalError('Both smartPtrType and smartPtr must be specified');
    }
    record.count = { value: 1 };
    return attachFinalizer(Object.create(prototype, { $$: { value: record, writable: true } }));
  };
  function RegisteredPointer_fromWireType(ptr) {
    var rawPointer = this.getPointee(ptr);
    if (!rawPointer) {
      this.destructor(ptr);
      return null;
    }
    var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
    if (undefined !== registeredInstance) {
      if (0 === registeredInstance.$$.count.value) {
        registeredInstance.$$.ptr = rawPointer;
        registeredInstance.$$.smartPtr = ptr;
        return registeredInstance['clone']();
      } else {
        var rv = registeredInstance['clone']();
        this.destructor(ptr);
        return rv;
      }
    }
    function makeDefaultHandle() {
      if (this.isSmartPointer) {
        return makeClassHandle(this.registeredClass.instancePrototype, {
          ptrType: this.pointeeType,
          ptr: rawPointer,
          smartPtrType: this,
          smartPtr: ptr,
        });
      } else {
        return makeClassHandle(this.registeredClass.instancePrototype, { ptrType: this, ptr });
      }
    }
    var actualType = this.registeredClass.getActualType(rawPointer);
    var registeredPointerRecord = registeredPointers[actualType];
    if (!registeredPointerRecord) {
      return makeDefaultHandle.call(this);
    }
    var toType;
    if (this.isConst) {
      toType = registeredPointerRecord.constPointerType;
    } else {
      toType = registeredPointerRecord.pointerType;
    }
    var dp = downcastPointer(rawPointer, this.registeredClass, toType.registeredClass);
    if (dp === null) {
      return makeDefaultHandle.call(this);
    }
    if (this.isSmartPointer) {
      return makeClassHandle(toType.registeredClass.instancePrototype, {
        ptrType: toType,
        ptr: dp,
        smartPtrType: this,
        smartPtr: ptr,
      });
    } else {
      return makeClassHandle(toType.registeredClass.instancePrototype, {
        ptrType: toType,
        ptr: dp,
      });
    }
  }
  var attachFinalizer = handle => {
    if ('undefined' === typeof FinalizationRegistry) {
      attachFinalizer = handle => handle;
      return handle;
    }
    finalizationRegistry = new FinalizationRegistry(info => {
      console.warn(info.leakWarning);
      releaseClassHandle(info.$$);
    });
    attachFinalizer = handle => {
      var $$ = handle.$$;
      var hasSmartPtr = !!$$.smartPtr;
      if (hasSmartPtr) {
        var info = { $$ };
        var cls = $$.ptrType.registeredClass;
        var err = new Error(
          `Embind found a leaked C++ instance ${cls.name} <${ptrToString($$.ptr)}>.\n` +
            "We'll free it automatically in this case, but this functionality is not reliable across various environments.\n" +
            "Make sure to invoke .delete() manually once you're done with the instance instead.\n" +
            'Originally allocated'
        );
        if ('captureStackTrace' in Error) {
          Error.captureStackTrace(err, RegisteredPointer_fromWireType);
        }
        info.leakWarning = err.stack.replace(/^Error: /, '');
        finalizationRegistry.register(handle, info, handle);
      }
      return handle;
    };
    detachFinalizer = handle => finalizationRegistry.unregister(handle);
    return attachFinalizer(handle);
  };
  var deletionQueue = [];
  var flushPendingDeletes = () => {
    while (deletionQueue.length) {
      var obj = deletionQueue.pop();
      obj.$$.deleteScheduled = false;
      obj['delete']();
    }
  };
  var delayFunction;
  var init_ClassHandle = () => {
    let proto = ClassHandle.prototype;
    Object.assign(proto, {
      isAliasOf(other) {
        if (!(this instanceof ClassHandle)) {
          return false;
        }
        if (!(other instanceof ClassHandle)) {
          return false;
        }
        var leftClass = this.$$.ptrType.registeredClass;
        var left = this.$$.ptr;
        other.$$ = other.$$;
        var rightClass = other.$$.ptrType.registeredClass;
        var right = other.$$.ptr;
        while (leftClass.baseClass) {
          left = leftClass.upcast(left);
          leftClass = leftClass.baseClass;
        }
        while (rightClass.baseClass) {
          right = rightClass.upcast(right);
          rightClass = rightClass.baseClass;
        }
        return leftClass === rightClass && left === right;
      },
      clone() {
        if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
        }
        if (this.$$.preservePointerOnDelete) {
          this.$$.count.value += 1;
          return this;
        } else {
          var clone = attachFinalizer(
            Object.create(Object.getPrototypeOf(this), {
              $$: { value: shallowCopyInternalPointer(this.$$) },
            })
          );
          clone.$$.count.value += 1;
          clone.$$.deleteScheduled = false;
          return clone;
        }
      },
      delete() {
        if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
        }
        if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
        }
        detachFinalizer(this);
        releaseClassHandle(this.$$);
        if (!this.$$.preservePointerOnDelete) {
          this.$$.smartPtr = undefined;
          this.$$.ptr = undefined;
        }
      },
      isDeleted() {
        return !this.$$.ptr;
      },
      deleteLater() {
        if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
        }
        if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
        }
        deletionQueue.push(this);
        if (deletionQueue.length === 1 && delayFunction) {
          delayFunction(flushPendingDeletes);
        }
        this.$$.deleteScheduled = true;
        return this;
      },
    });
    const symbolDispose = Symbol.dispose;
    if (symbolDispose) {
      proto[symbolDispose] = proto['delete'];
    }
  };
  function ClassHandle() {}
  var createNamedFunction = (name, func) => Object.defineProperty(func, 'name', { value: name });
  var ensureOverloadTable = (proto, methodName, humanName) => {
    if (undefined === proto[methodName].overloadTable) {
      var prevFunc = proto[methodName];
      proto[methodName] = function (...args) {
        if (!proto[methodName].overloadTable.hasOwnProperty(args.length)) {
          throwBindingError(
            `Function '${humanName}' called with an invalid number of arguments (${args.length}) - expects one of (${proto[methodName].overloadTable})!`
          );
        }
        return proto[methodName].overloadTable[args.length].apply(this, args);
      };
      proto[methodName].overloadTable = [];
      proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
    }
  };
  var exposePublicSymbol = (name, value, numArguments) => {
    if (Module.hasOwnProperty(name)) {
      if (
        undefined === numArguments ||
        (undefined !== Module[name].overloadTable &&
          undefined !== Module[name].overloadTable[numArguments])
      ) {
        throwBindingError(`Cannot register public name '${name}' twice`);
      }
      ensureOverloadTable(Module, name, name);
      if (Module[name].overloadTable.hasOwnProperty(numArguments)) {
        throwBindingError(
          `Cannot register multiple overloads of a function with the same number of arguments (${numArguments})!`
        );
      }
      Module[name].overloadTable[numArguments] = value;
    } else {
      Module[name] = value;
      Module[name].argCount = numArguments;
    }
  };
  var char_0 = 48;
  var char_9 = 57;
  var makeLegalFunctionName = name => {
    assert(typeof name === 'string');
    name = name.replace(/[^a-zA-Z0-9_]/g, '$');
    var f = name.charCodeAt(0);
    if (f >= char_0 && f <= char_9) {
      return `_${name}`;
    }
    return name;
  };
  function RegisteredClass(
    name,
    constructor,
    instancePrototype,
    rawDestructor,
    baseClass,
    getActualType,
    upcast,
    downcast
  ) {
    this.name = name;
    this.constructor = constructor;
    this.instancePrototype = instancePrototype;
    this.rawDestructor = rawDestructor;
    this.baseClass = baseClass;
    this.getActualType = getActualType;
    this.upcast = upcast;
    this.downcast = downcast;
    this.pureVirtualFunctions = [];
  }
  var upcastPointer = (ptr, ptrClass, desiredClass) => {
    while (ptrClass !== desiredClass) {
      if (!ptrClass.upcast) {
        throwBindingError(
          `Expected null or instance of ${desiredClass.name}, got an instance of ${ptrClass.name}`
        );
      }
      ptr = ptrClass.upcast(ptr);
      ptrClass = ptrClass.baseClass;
    }
    return ptr;
  };
  function constNoSmartPtrRawPointerToWireType(destructors, handle) {
    if (handle === null) {
      if (this.isReference) {
        throwBindingError(`null is not a valid ${this.name}`);
      }
      return 0;
    }
    if (!handle.$$) {
      throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
    }
    if (!handle.$$.ptr) {
      throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    return ptr;
  }
  function genericPointerToWireType(destructors, handle) {
    var ptr;
    if (handle === null) {
      if (this.isReference) {
        throwBindingError(`null is not a valid ${this.name}`);
      }
      if (this.isSmartPointer) {
        ptr = this.rawConstructor();
        if (destructors !== null) {
          destructors.push(this.rawDestructor, ptr);
        }
        return ptr;
      } else {
        return 0;
      }
    }
    if (!handle || !handle.$$) {
      throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
    }
    if (!handle.$$.ptr) {
      throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
    }
    if (!this.isConst && handle.$$.ptrType.isConst) {
      throwBindingError(
        `Cannot convert argument of type ${handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name} to parameter type ${this.name}`
      );
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    if (this.isSmartPointer) {
      if (undefined === handle.$$.smartPtr) {
        throwBindingError('Passing raw pointer to smart pointer is illegal');
      }
      switch (this.sharingPolicy) {
        case 0:
          if (handle.$$.smartPtrType === this) {
            ptr = handle.$$.smartPtr;
          } else {
            throwBindingError(
              `Cannot convert argument of type ${handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name} to parameter type ${this.name}`
            );
          }
          break;
        case 1:
          ptr = handle.$$.smartPtr;
          break;
        case 2:
          if (handle.$$.smartPtrType === this) {
            ptr = handle.$$.smartPtr;
          } else {
            var clonedHandle = handle['clone']();
            ptr = this.rawShare(
              ptr,
              Emval.toHandle(() => clonedHandle['delete']())
            );
            if (destructors !== null) {
              destructors.push(this.rawDestructor, ptr);
            }
          }
          break;
        default:
          throwBindingError('Unsupporting sharing policy');
      }
    }
    return ptr;
  }
  function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
    if (handle === null) {
      if (this.isReference) {
        throwBindingError(`null is not a valid ${this.name}`);
      }
      return 0;
    }
    if (!handle.$$) {
      throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
    }
    if (!handle.$$.ptr) {
      throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
    }
    if (handle.$$.ptrType.isConst) {
      throwBindingError(
        `Cannot convert argument of type ${handle.$$.ptrType.name} to parameter type ${this.name}`
      );
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    return ptr;
  }
  var init_RegisteredPointer = () => {
    Object.assign(RegisteredPointer.prototype, {
      getPointee(ptr) {
        if (this.rawGetPointee) {
          ptr = this.rawGetPointee(ptr);
        }
        return ptr;
      },
      destructor(ptr) {
        this.rawDestructor?.(ptr);
      },
      readValueFromPointer: readPointer,
      fromWireType: RegisteredPointer_fromWireType,
    });
  };
  function RegisteredPointer(
    name,
    registeredClass,
    isReference,
    isConst,
    isSmartPointer,
    pointeeType,
    sharingPolicy,
    rawGetPointee,
    rawConstructor,
    rawShare,
    rawDestructor
  ) {
    this.name = name;
    this.registeredClass = registeredClass;
    this.isReference = isReference;
    this.isConst = isConst;
    this.isSmartPointer = isSmartPointer;
    this.pointeeType = pointeeType;
    this.sharingPolicy = sharingPolicy;
    this.rawGetPointee = rawGetPointee;
    this.rawConstructor = rawConstructor;
    this.rawShare = rawShare;
    this.rawDestructor = rawDestructor;
    if (!isSmartPointer && registeredClass.baseClass === undefined) {
      if (isConst) {
        this.toWireType = constNoSmartPtrRawPointerToWireType;
        this.destructorFunction = null;
      } else {
        this.toWireType = nonConstNoSmartPtrRawPointerToWireType;
        this.destructorFunction = null;
      }
    } else {
      this.toWireType = genericPointerToWireType;
    }
  }
  var replacePublicSymbol = (name, value, numArguments) => {
    if (!Module.hasOwnProperty(name)) {
      throwInternalError('Replacing nonexistent public symbol');
    }
    if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
      Module[name].overloadTable[numArguments] = value;
    } else {
      Module[name] = value;
      Module[name].argCount = numArguments;
    }
  };
  var wasmTableMirror = [];
  var wasmTable;
  var getWasmTableEntry = funcPtr => {
    var func = wasmTableMirror[funcPtr];
    if (!func) {
      wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
    }
    assert(
      wasmTable.get(funcPtr) == func,
      'JavaScript-side Wasm function table mirror is out of date!'
    );
    return func;
  };
  var embind__requireFunction = (signature, rawFunction, isAsync = false) => {
    assert(!isAsync, 'Async bindings are only supported with JSPI.');
    signature = AsciiToString(signature);
    function makeDynCaller() {
      var rtn = getWasmTableEntry(rawFunction);
      return rtn;
    }
    var fp = makeDynCaller();
    if (typeof fp != 'function') {
      throwBindingError(`unknown function pointer with signature ${signature}: ${rawFunction}`);
    }
    return fp;
  };
  class UnboundTypeError extends Error {}
  var getTypeName = type => {
    var ptr = ___getTypeName(type);
    var rv = AsciiToString(ptr);
    _free(ptr);
    return rv;
  };
  var throwUnboundTypeError = (message, types) => {
    var unboundTypes = [];
    var seen = {};
    function visit(type) {
      if (seen[type]) {
        return;
      }
      if (registeredTypes[type]) {
        return;
      }
      if (typeDependencies[type]) {
        typeDependencies[type].forEach(visit);
        return;
      }
      unboundTypes.push(type);
      seen[type] = true;
    }
    types.forEach(visit);
    throw new UnboundTypeError(`${message}: ` + unboundTypes.map(getTypeName).join([', ']));
  };
  var __embind_register_class = (
    rawType,
    rawPointerType,
    rawConstPointerType,
    baseClassRawType,
    getActualTypeSignature,
    getActualType,
    upcastSignature,
    upcast,
    downcastSignature,
    downcast,
    name,
    destructorSignature,
    rawDestructor
  ) => {
    name = AsciiToString(name);
    getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
    upcast &&= embind__requireFunction(upcastSignature, upcast);
    downcast &&= embind__requireFunction(downcastSignature, downcast);
    rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
    var legalFunctionName = makeLegalFunctionName(name);
    exposePublicSymbol(legalFunctionName, function () {
      throwUnboundTypeError(`Cannot construct ${name} due to unbound types`, [baseClassRawType]);
    });
    whenDependentTypesAreResolved(
      [rawType, rawPointerType, rawConstPointerType],
      baseClassRawType ? [baseClassRawType] : [],
      base => {
        base = base[0];
        var baseClass;
        var basePrototype;
        if (baseClassRawType) {
          baseClass = base.registeredClass;
          basePrototype = baseClass.instancePrototype;
        } else {
          basePrototype = ClassHandle.prototype;
        }
        var constructor = createNamedFunction(name, function (...args) {
          if (Object.getPrototypeOf(this) !== instancePrototype) {
            throw new BindingError(`Use 'new' to construct ${name}`);
          }
          if (undefined === registeredClass.constructor_body) {
            throw new BindingError(`${name} has no accessible constructor`);
          }
          var body = registeredClass.constructor_body[args.length];
          if (undefined === body) {
            throw new BindingError(
              `Tried to invoke ctor of ${name} with invalid number of parameters (${args.length}) - expected (${Object.keys(registeredClass.constructor_body).toString()}) parameters instead!`
            );
          }
          return body.apply(this, args);
        });
        var instancePrototype = Object.create(basePrototype, {
          constructor: { value: constructor },
        });
        constructor.prototype = instancePrototype;
        var registeredClass = new RegisteredClass(
          name,
          constructor,
          instancePrototype,
          rawDestructor,
          baseClass,
          getActualType,
          upcast,
          downcast
        );
        if (registeredClass.baseClass) {
          registeredClass.baseClass.__derivedClasses ??= [];
          registeredClass.baseClass.__derivedClasses.push(registeredClass);
        }
        var referenceConverter = new RegisteredPointer(name, registeredClass, true, false, false);
        var pointerConverter = new RegisteredPointer(
          name + '*',
          registeredClass,
          false,
          false,
          false
        );
        var constPointerConverter = new RegisteredPointer(
          name + ' const*',
          registeredClass,
          false,
          true,
          false
        );
        registeredPointers[rawType] = {
          pointerType: pointerConverter,
          constPointerType: constPointerConverter,
        };
        replacePublicSymbol(legalFunctionName, constructor);
        return [referenceConverter, pointerConverter, constPointerConverter];
      }
    );
  };
  var heap32VectorToArray = (count, firstElement) => {
    var array = [];
    for (var i = 0; i < count; i++) {
      array.push(HEAPU32[(firstElement + i * 4) >> 2]);
    }
    return array;
  };
  function usesDestructorStack(argTypes) {
    for (var i = 1; i < argTypes.length; ++i) {
      if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) {
        return true;
      }
    }
    return false;
  }
  function checkArgCount(numArgs, minArgs, maxArgs, humanName, throwBindingError) {
    if (numArgs < minArgs || numArgs > maxArgs) {
      var argCountMessage = minArgs == maxArgs ? minArgs : `${minArgs} to ${maxArgs}`;
      throwBindingError(
        `function ${humanName} called with ${numArgs} arguments, expected ${argCountMessage}`
      );
    }
  }
  function createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync) {
    var needsDestructorStack = usesDestructorStack(argTypes);
    var argCount = argTypes.length - 2;
    var argsList = [];
    var argsListWired = ['fn'];
    if (isClassMethodFunc) {
      argsListWired.push('thisWired');
    }
    for (var i = 0; i < argCount; ++i) {
      argsList.push(`arg${i}`);
      argsListWired.push(`arg${i}Wired`);
    }
    argsList = argsList.join(',');
    argsListWired = argsListWired.join(',');
    var invokerFnBody = `return function (${argsList}) {\n`;
    invokerFnBody +=
      'checkArgCount(arguments.length, minArgs, maxArgs, humanName, throwBindingError);\n';
    if (needsDestructorStack) {
      invokerFnBody += 'var destructors = [];\n';
    }
    var dtorStack = needsDestructorStack ? 'destructors' : 'null';
    var args1 = [
      'humanName',
      'throwBindingError',
      'invoker',
      'fn',
      'runDestructors',
      'fromRetWire',
      'toClassParamWire',
    ];
    if (isClassMethodFunc) {
      invokerFnBody += `var thisWired = toClassParamWire(${dtorStack}, this);\n`;
    }
    for (var i = 0; i < argCount; ++i) {
      var argName = `toArg${i}Wire`;
      invokerFnBody += `var arg${i}Wired = ${argName}(${dtorStack}, arg${i});\n`;
      args1.push(argName);
    }
    invokerFnBody += (returns || isAsync ? 'var rv = ' : '') + `invoker(${argsListWired});\n`;
    if (needsDestructorStack) {
      invokerFnBody += 'runDestructors(destructors);\n';
    } else {
      for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
        var paramName = i === 1 ? 'thisWired' : 'arg' + (i - 2) + 'Wired';
        if (argTypes[i].destructorFunction !== null) {
          invokerFnBody += `${paramName}_dtor(${paramName});\n`;
          args1.push(`${paramName}_dtor`);
        }
      }
    }
    if (returns) {
      invokerFnBody += 'var ret = fromRetWire(rv);\n' + 'return ret;\n';
    } else {
    }
    invokerFnBody += '}\n';
    args1.push('checkArgCount', 'minArgs', 'maxArgs');
    invokerFnBody = `if (arguments.length !== ${args1.length}){ throw new Error(humanName + "Expected ${args1.length} closure arguments " + arguments.length + " given."); }\n${invokerFnBody}`;
    return new Function(args1, invokerFnBody);
  }
  function getRequiredArgCount(argTypes) {
    var requiredArgCount = argTypes.length - 2;
    for (var i = argTypes.length - 1; i >= 2; --i) {
      if (!argTypes[i].optional) {
        break;
      }
      requiredArgCount--;
    }
    return requiredArgCount;
  }
  function craftInvokerFunction(
    humanName,
    argTypes,
    classType,
    cppInvokerFunc,
    cppTargetFunc,
    isAsync
  ) {
    var argCount = argTypes.length;
    if (argCount < 2) {
      throwBindingError(
        "argTypes array size mismatch! Must at least get return value and 'this' types!"
      );
    }
    assert(!isAsync, 'Async bindings are only supported with JSPI.');
    var isClassMethodFunc = argTypes[1] !== null && classType !== null;
    var needsDestructorStack = usesDestructorStack(argTypes);
    var returns = !argTypes[0].isVoid;
    var expectedArgCount = argCount - 2;
    var minArgs = getRequiredArgCount(argTypes);
    var retType = argTypes[0];
    var instType = argTypes[1];
    var closureArgs = [
      humanName,
      throwBindingError,
      cppInvokerFunc,
      cppTargetFunc,
      runDestructors,
      retType.fromWireType.bind(retType),
      instType?.toWireType.bind(instType),
    ];
    for (var i = 2; i < argCount; ++i) {
      var argType = argTypes[i];
      closureArgs.push(argType.toWireType.bind(argType));
    }
    if (!needsDestructorStack) {
      for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
        if (argTypes[i].destructorFunction !== null) {
          closureArgs.push(argTypes[i].destructorFunction);
        }
      }
    }
    closureArgs.push(checkArgCount, minArgs, expectedArgCount);
    let invokerFactory = createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync);
    var invokerFn = invokerFactory(...closureArgs);
    return createNamedFunction(humanName, invokerFn);
  }
  var __embind_register_class_constructor = (
    rawClassType,
    argCount,
    rawArgTypesAddr,
    invokerSignature,
    invoker,
    rawConstructor
  ) => {
    assert(argCount > 0);
    var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    invoker = embind__requireFunction(invokerSignature, invoker);
    whenDependentTypesAreResolved([], [rawClassType], classType => {
      classType = classType[0];
      var humanName = `constructor ${classType.name}`;
      if (undefined === classType.registeredClass.constructor_body) {
        classType.registeredClass.constructor_body = [];
      }
      if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
        throw new BindingError(
          `Cannot register multiple constructors with identical number of parameters (${argCount - 1}) for class '${classType.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`
        );
      }
      classType.registeredClass.constructor_body[argCount - 1] = () => {
        throwUnboundTypeError(
          `Cannot construct ${classType.name} due to unbound types`,
          rawArgTypes
        );
      };
      whenDependentTypesAreResolved([], rawArgTypes, argTypes => {
        argTypes.splice(1, 0, null);
        classType.registeredClass.constructor_body[argCount - 1] = craftInvokerFunction(
          humanName,
          argTypes,
          null,
          invoker,
          rawConstructor
        );
        return [];
      });
      return [];
    });
  };
  var getFunctionName = signature => {
    signature = signature.trim();
    const argsIndex = signature.indexOf('(');
    if (argsIndex === -1) return signature;
    assert(signature.endsWith(')'), 'Parentheses for argument names should match.');
    return signature.slice(0, argsIndex);
  };
  var __embind_register_class_function = (
    rawClassType,
    methodName,
    argCount,
    rawArgTypesAddr,
    invokerSignature,
    rawInvoker,
    context,
    isPureVirtual,
    isAsync,
    isNonnullReturn
  ) => {
    var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    methodName = AsciiToString(methodName);
    methodName = getFunctionName(methodName);
    rawInvoker = embind__requireFunction(invokerSignature, rawInvoker, isAsync);
    whenDependentTypesAreResolved([], [rawClassType], classType => {
      classType = classType[0];
      var humanName = `${classType.name}.${methodName}`;
      if (methodName.startsWith('@@')) {
        methodName = Symbol[methodName.substring(2)];
      }
      if (isPureVirtual) {
        classType.registeredClass.pureVirtualFunctions.push(methodName);
      }
      function unboundTypesHandler() {
        throwUnboundTypeError(`Cannot call ${humanName} due to unbound types`, rawArgTypes);
      }
      var proto = classType.registeredClass.instancePrototype;
      var method = proto[methodName];
      if (
        undefined === method ||
        (undefined === method.overloadTable &&
          method.className !== classType.name &&
          method.argCount === argCount - 2)
      ) {
        unboundTypesHandler.argCount = argCount - 2;
        unboundTypesHandler.className = classType.name;
        proto[methodName] = unboundTypesHandler;
      } else {
        ensureOverloadTable(proto, methodName, humanName);
        proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
      }
      whenDependentTypesAreResolved([], rawArgTypes, argTypes => {
        var memberFunction = craftInvokerFunction(
          humanName,
          argTypes,
          classType,
          rawInvoker,
          context,
          isAsync
        );
        if (undefined === proto[methodName].overloadTable) {
          memberFunction.argCount = argCount - 2;
          proto[methodName] = memberFunction;
        } else {
          proto[methodName].overloadTable[argCount - 2] = memberFunction;
        }
        return [];
      });
      return [];
    });
  };
  var emval_freelist = [];
  var emval_handles = [0, 1, , 1, null, 1, true, 1, false, 1];
  var __emval_decref = handle => {
    if (handle > 9 && 0 === --emval_handles[handle + 1]) {
      assert(emval_handles[handle] !== undefined, `Decref for unallocated handle.`);
      emval_handles[handle] = undefined;
      emval_freelist.push(handle);
    }
  };
  var Emval = {
    toValue: handle => {
      if (!handle) {
        throwBindingError(`Cannot use deleted val. handle = ${handle}`);
      }
      assert(
        handle === 2 || (emval_handles[handle] !== undefined && handle % 2 === 0),
        `invalid handle: ${handle}`
      );
      return emval_handles[handle];
    },
    toHandle: value => {
      switch (value) {
        case undefined:
          return 2;
        case null:
          return 4;
        case true:
          return 6;
        case false:
          return 8;
        default: {
          const handle = emval_freelist.pop() || emval_handles.length;
          emval_handles[handle] = value;
          emval_handles[handle + 1] = 1;
          return handle;
        }
      }
    },
  };
  var EmValType = {
    name: 'emscripten::val',
    fromWireType: handle => {
      var rv = Emval.toValue(handle);
      __emval_decref(handle);
      return rv;
    },
    toWireType: (destructors, value) => Emval.toHandle(value),
    readValueFromPointer: readPointer,
    destructorFunction: null,
  };
  var __embind_register_emval = rawType => registerType(rawType, EmValType);
  var floatReadValueFromPointer = (name, width) => {
    switch (width) {
      case 4:
        return function (pointer) {
          return this.fromWireType(HEAPF32[pointer >> 2]);
        };
      case 8:
        return function (pointer) {
          return this.fromWireType(HEAPF64[pointer >> 3]);
        };
      default:
        throw new TypeError(`invalid float width (${width}): ${name}`);
    }
  };
  var __embind_register_float = (rawType, name, size) => {
    name = AsciiToString(name);
    registerType(rawType, {
      name,
      fromWireType: value => value,
      toWireType: (destructors, value) => {
        if (typeof value != 'number' && typeof value != 'boolean') {
          throw new TypeError(`Cannot convert ${embindRepr(value)} to ${this.name}`);
        }
        return value;
      },
      readValueFromPointer: floatReadValueFromPointer(name, size),
      destructorFunction: null,
    });
  };
  var __embind_register_integer = (primitiveType, name, size, minRange, maxRange) => {
    name = AsciiToString(name);
    const isUnsignedType = minRange === 0;
    let fromWireType = value => value;
    if (isUnsignedType) {
      var bitshift = 32 - 8 * size;
      fromWireType = value => (value << bitshift) >>> bitshift;
      maxRange = fromWireType(maxRange);
    }
    registerType(primitiveType, {
      name,
      fromWireType,
      toWireType: (destructors, value) => {
        if (typeof value != 'number' && typeof value != 'boolean') {
          throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${name}`);
        }
        assertIntegerRange(name, value, minRange, maxRange);
        return value;
      },
      readValueFromPointer: integerReadValueFromPointer(name, size, minRange !== 0),
      destructorFunction: null,
    });
  };
  var __embind_register_memory_view = (rawType, dataTypeIndex, name) => {
    var typeMapping = [
      Int8Array,
      Uint8Array,
      Int16Array,
      Uint16Array,
      Int32Array,
      Uint32Array,
      Float32Array,
      Float64Array,
      BigInt64Array,
      BigUint64Array,
    ];
    var TA = typeMapping[dataTypeIndex];
    function decodeMemoryView(handle) {
      var size = HEAPU32[handle >> 2];
      var data = HEAPU32[(handle + 4) >> 2];
      return new TA(HEAP8.buffer, data, size);
    }
    name = AsciiToString(name);
    registerType(
      rawType,
      { name, fromWireType: decodeMemoryView, readValueFromPointer: decodeMemoryView },
      { ignoreDuplicateRegistrations: true }
    );
  };
  var EmValOptionalType = Object.assign({ optional: true }, EmValType);
  var __embind_register_optional = (rawOptionalType, rawType) => {
    registerType(rawOptionalType, EmValOptionalType);
  };
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    assert(typeof str === 'string', `stringToUTF8Array expects a string (got ${typeof str})`);
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.codePointAt(i);
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 192 | (u >> 6);
        heap[outIdx++] = 128 | (u & 63);
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 224 | (u >> 12);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
      } else {
        if (outIdx + 3 >= endIdx) break;
        if (u > 1114111)
          warnOnce(
            'Invalid Unicode code point ' +
              ptrToString(u) +
              ' encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).'
          );
        heap[outIdx++] = 240 | (u >> 18);
        heap[outIdx++] = 128 | ((u >> 12) & 63);
        heap[outIdx++] = 128 | ((u >> 6) & 63);
        heap[outIdx++] = 128 | (u & 63);
        i++;
      }
    }
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
    assert(
      typeof maxBytesToWrite == 'number',
      'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!'
    );
    return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  };
  var lengthBytesUTF8 = str => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var c = str.charCodeAt(i);
      if (c <= 127) {
        len++;
      } else if (c <= 2047) {
        len += 2;
      } else if (c >= 55296 && c <= 57343) {
        len += 4;
        ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };
  var UTF8Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder() : undefined;
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
    var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
    if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
      return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
    }
    var str = '';
    while (idx < endPtr) {
      var u0 = heapOrArray[idx++];
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }
      var u1 = heapOrArray[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode(((u0 & 31) << 6) | u1);
        continue;
      }
      var u2 = heapOrArray[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 248) != 240)
          warnOnce(
            'Invalid UTF-8 leading byte ' +
              ptrToString(u0) +
              ' encountered when deserializing a UTF-8 string in wasm memory to a JS string!'
          );
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
      }
      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
      }
    }
    return str;
  };
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => {
    assert(typeof ptr == 'number', `UTF8ToString expects a number (got ${typeof ptr})`);
    return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : '';
  };
  var __embind_register_std_string = (rawType, name) => {
    name = AsciiToString(name);
    var stdStringIsUTF8 = true;
    registerType(rawType, {
      name,
      fromWireType(value) {
        var length = HEAPU32[value >> 2];
        var payload = value + 4;
        var str;
        if (stdStringIsUTF8) {
          str = UTF8ToString(payload, length, true);
        } else {
          str = '';
          for (var i = 0; i < length; ++i) {
            str += String.fromCharCode(HEAPU8[payload + i]);
          }
        }
        _free(value);
        return str;
      },
      toWireType(destructors, value) {
        if (value instanceof ArrayBuffer) {
          value = new Uint8Array(value);
        }
        var length;
        var valueIsOfTypeString = typeof value == 'string';
        if (!(valueIsOfTypeString || (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT == 1))) {
          throwBindingError('Cannot pass non-string to std::string');
        }
        if (stdStringIsUTF8 && valueIsOfTypeString) {
          length = lengthBytesUTF8(value);
        } else {
          length = value.length;
        }
        var base = _malloc(4 + length + 1);
        var ptr = base + 4;
        HEAPU32[base >> 2] = length;
        if (valueIsOfTypeString) {
          if (stdStringIsUTF8) {
            stringToUTF8(value, ptr, length + 1);
          } else {
            for (var i = 0; i < length; ++i) {
              var charCode = value.charCodeAt(i);
              if (charCode > 255) {
                _free(base);
                throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
              }
              HEAPU8[ptr + i] = charCode;
            }
          }
        } else {
          HEAPU8.set(value, ptr);
        }
        if (destructors !== null) {
          destructors.push(_free, base);
        }
        return base;
      },
      readValueFromPointer: readPointer,
      destructorFunction(ptr) {
        _free(ptr);
      },
    });
  };
  var UTF16Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder('utf-16le') : undefined;
  var UTF16ToString = (ptr, maxBytesToRead, ignoreNul) => {
    assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
    var idx = ptr >> 1;
    var endIdx = findStringEnd(HEAPU16, idx, maxBytesToRead / 2, ignoreNul);
    if (endIdx - idx > 16 && UTF16Decoder)
      return UTF16Decoder.decode(HEAPU16.subarray(idx, endIdx));
    var str = '';
    for (var i = idx; i < endIdx; ++i) {
      var codeUnit = HEAPU16[i];
      str += String.fromCharCode(codeUnit);
    }
    return str;
  };
  var stringToUTF16 = (str, outPtr, maxBytesToWrite) => {
    assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
    assert(
      typeof maxBytesToWrite == 'number',
      'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!'
    );
    maxBytesToWrite ??= 2147483647;
    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    var startPtr = outPtr;
    var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
    for (var i = 0; i < numCharsToWrite; ++i) {
      var codeUnit = str.charCodeAt(i);
      HEAP16[outPtr >> 1] = codeUnit;
      outPtr += 2;
    }
    HEAP16[outPtr >> 1] = 0;
    return outPtr - startPtr;
  };
  var lengthBytesUTF16 = str => str.length * 2;
  var UTF32ToString = (ptr, maxBytesToRead, ignoreNul) => {
    assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
    var str = '';
    var startIdx = ptr >> 2;
    for (var i = 0; !(i >= maxBytesToRead / 4); i++) {
      var utf32 = HEAPU32[startIdx + i];
      if (!utf32 && !ignoreNul) break;
      str += String.fromCodePoint(utf32);
    }
    return str;
  };
  var stringToUTF32 = (str, outPtr, maxBytesToWrite) => {
    assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
    assert(
      typeof maxBytesToWrite == 'number',
      'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!'
    );
    maxBytesToWrite ??= 2147483647;
    if (maxBytesToWrite < 4) return 0;
    var startPtr = outPtr;
    var endPtr = startPtr + maxBytesToWrite - 4;
    for (var i = 0; i < str.length; ++i) {
      var codePoint = str.codePointAt(i);
      if (codePoint > 65535) {
        i++;
      }
      HEAP32[outPtr >> 2] = codePoint;
      outPtr += 4;
      if (outPtr + 4 > endPtr) break;
    }
    HEAP32[outPtr >> 2] = 0;
    return outPtr - startPtr;
  };
  var lengthBytesUTF32 = str => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var codePoint = str.codePointAt(i);
      if (codePoint > 65535) {
        i++;
      }
      len += 4;
    }
    return len;
  };
  var __embind_register_std_wstring = (rawType, charSize, name) => {
    name = AsciiToString(name);
    var decodeString, encodeString, lengthBytesUTF;
    if (charSize === 2) {
      decodeString = UTF16ToString;
      encodeString = stringToUTF16;
      lengthBytesUTF = lengthBytesUTF16;
    } else {
      assert(charSize === 4, 'only 2-byte and 4-byte strings are currently supported');
      decodeString = UTF32ToString;
      encodeString = stringToUTF32;
      lengthBytesUTF = lengthBytesUTF32;
    }
    registerType(rawType, {
      name,
      fromWireType: value => {
        var length = HEAPU32[value >> 2];
        var str = decodeString(value + 4, length * charSize, true);
        _free(value);
        return str;
      },
      toWireType: (destructors, value) => {
        if (!(typeof value == 'string')) {
          throwBindingError(`Cannot pass non-string to C++ string type ${name}`);
        }
        var length = lengthBytesUTF(value);
        var ptr = _malloc(4 + length + charSize);
        HEAPU32[ptr >> 2] = length / charSize;
        encodeString(value, ptr + 4, length + charSize);
        if (destructors !== null) {
          destructors.push(_free, ptr);
        }
        return ptr;
      },
      readValueFromPointer: readPointer,
      destructorFunction(ptr) {
        _free(ptr);
      },
    });
  };
  var __embind_register_value_array = (
    rawType,
    name,
    constructorSignature,
    rawConstructor,
    destructorSignature,
    rawDestructor
  ) => {
    tupleRegistrations[rawType] = {
      name: AsciiToString(name),
      rawConstructor: embind__requireFunction(constructorSignature, rawConstructor),
      rawDestructor: embind__requireFunction(destructorSignature, rawDestructor),
      elements: [],
    };
  };
  var __embind_register_value_array_element = (
    rawTupleType,
    getterReturnType,
    getterSignature,
    getter,
    getterContext,
    setterArgumentType,
    setterSignature,
    setter,
    setterContext
  ) => {
    tupleRegistrations[rawTupleType].elements.push({
      getterReturnType,
      getter: embind__requireFunction(getterSignature, getter),
      getterContext,
      setterArgumentType,
      setter: embind__requireFunction(setterSignature, setter),
      setterContext,
    });
  };
  var __embind_register_value_object = (
    rawType,
    name,
    constructorSignature,
    rawConstructor,
    destructorSignature,
    rawDestructor
  ) => {
    structRegistrations[rawType] = {
      name: AsciiToString(name),
      rawConstructor: embind__requireFunction(constructorSignature, rawConstructor),
      rawDestructor: embind__requireFunction(destructorSignature, rawDestructor),
      fields: [],
    };
  };
  var __embind_register_value_object_field = (
    structType,
    fieldName,
    getterReturnType,
    getterSignature,
    getter,
    getterContext,
    setterArgumentType,
    setterSignature,
    setter,
    setterContext
  ) => {
    structRegistrations[structType].fields.push({
      fieldName: AsciiToString(fieldName),
      getterReturnType,
      getter: embind__requireFunction(getterSignature, getter),
      getterContext,
      setterArgumentType,
      setter: embind__requireFunction(setterSignature, setter),
      setterContext,
    });
  };
  var __embind_register_void = (rawType, name) => {
    name = AsciiToString(name);
    registerType(rawType, {
      isVoid: true,
      name,
      fromWireType: () => undefined,
      toWireType: (destructors, o) => undefined,
    });
  };
  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
    noExitRuntime = false;
    runtimeKeepaliveCounter = 0;
  };
  var emval_methodCallers = [];
  var emval_addMethodCaller = caller => {
    var id = emval_methodCallers.length;
    emval_methodCallers.push(caller);
    return id;
  };
  var requireRegisteredType = (rawType, humanName) => {
    var impl = registeredTypes[rawType];
    if (undefined === impl) {
      throwBindingError(`${humanName} has unknown type ${getTypeName(rawType)}`);
    }
    return impl;
  };
  var emval_lookupTypes = (argCount, argTypes) => {
    var a = new Array(argCount);
    for (var i = 0; i < argCount; ++i) {
      a[i] = requireRegisteredType(HEAPU32[(argTypes + i * 4) >> 2], `parameter ${i}`);
    }
    return a;
  };
  var emval_returnValue = (toReturnWire, destructorsRef, handle) => {
    var destructors = [];
    var result = toReturnWire(destructors, handle);
    if (destructors.length) {
      HEAPU32[destructorsRef >> 2] = Emval.toHandle(destructors);
    }
    return result;
  };
  var emval_symbols = {};
  var getStringOrSymbol = address => {
    var symbol = emval_symbols[address];
    if (symbol === undefined) {
      return AsciiToString(address);
    }
    return symbol;
  };
  var __emval_create_invoker = (argCount, argTypesPtr, kind) => {
    var GenericWireTypeSize = 8;
    var [retType, ...argTypes] = emval_lookupTypes(argCount, argTypesPtr);
    var toReturnWire = retType.toWireType.bind(retType);
    var argFromPtr = argTypes.map(type => type.readValueFromPointer.bind(type));
    argCount--;
    var captures = { toValue: Emval.toValue };
    var args = argFromPtr.map((argFromPtr, i) => {
      var captureName = `argFromPtr${i}`;
      captures[captureName] = argFromPtr;
      return `${captureName}(args${i ? '+' + i * GenericWireTypeSize : ''})`;
    });
    var functionBody;
    switch (kind) {
      case 0:
        functionBody = 'toValue(handle)';
        break;
      case 2:
        functionBody = 'new (toValue(handle))';
        break;
      case 3:
        functionBody = '';
        break;
      case 1:
        captures['getStringOrSymbol'] = getStringOrSymbol;
        functionBody = 'toValue(handle)[getStringOrSymbol(methodName)]';
        break;
    }
    functionBody += `(${args})`;
    if (!retType.isVoid) {
      captures['toReturnWire'] = toReturnWire;
      captures['emval_returnValue'] = emval_returnValue;
      functionBody = `return emval_returnValue(toReturnWire, destructorsRef, ${functionBody})`;
    }
    functionBody = `return function (handle, methodName, destructorsRef, args) {\n  ${functionBody}\n  }`;
    var invokerFunction = new Function(Object.keys(captures), functionBody)(
      ...Object.values(captures)
    );
    var functionName = `methodCaller<(${argTypes.map(t => t.name)}) => ${retType.name}>`;
    return emval_addMethodCaller(createNamedFunction(functionName, invokerFunction));
  };
  var emval_get_global = () => globalThis;
  var __emval_get_global = name => {
    if (name === 0) {
      return Emval.toHandle(emval_get_global());
    } else {
      name = getStringOrSymbol(name);
      return Emval.toHandle(emval_get_global()[name]);
    }
  };
  var __emval_incref = handle => {
    if (handle > 9) {
      emval_handles[handle + 1] += 1;
    }
  };
  var __emval_invoke = (caller, handle, methodName, destructorsRef, args) =>
    emval_methodCallers[caller](handle, methodName, destructorsRef, args);
  var __emval_new_cstring = v => Emval.toHandle(getStringOrSymbol(v));
  var __emval_new_object = () => Emval.toHandle({});
  var __emval_run_destructors = handle => {
    var destructors = Emval.toValue(handle);
    runDestructors(destructors);
    __emval_decref(handle);
  };
  var __emval_set_property = (handle, key, value) => {
    handle = Emval.toValue(handle);
    key = Emval.toValue(key);
    value = Emval.toValue(value);
    handle[key] = value;
  };
  var timers = {};
  var handleException = e => {
    if (e instanceof ExitStatus || e == 'unwind') {
      return EXITSTATUS;
    }
    checkStackCookie();
    if (e instanceof WebAssembly.RuntimeError) {
      if (_emscripten_stack_get_current() <= 0) {
        err(
          'Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)'
        );
      }
    }
    quit_(1, e);
  };
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = code => {
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module['onExit']?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  };
  var exitJS = (status, implicit) => {
    EXITSTATUS = status;
    checkUnflushedContent();
    if (keepRuntimeAlive() && !implicit) {
      var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
      readyPromiseReject?.(msg);
      err(msg);
    }
    _proc_exit(status);
  };
  var _exit = exitJS;
  var maybeExit = () => {
    if (!keepRuntimeAlive()) {
      try {
        _exit(EXITSTATUS);
      } catch (e) {
        handleException(e);
      }
    }
  };
  var callUserCallback = func => {
    if (ABORT) {
      err('user callback triggered after runtime exited or application aborted.  Ignoring.');
      return;
    }
    try {
      func();
      maybeExit();
    } catch (e) {
      handleException(e);
    }
  };
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
    if (timers[which]) {
      clearTimeout(timers[which].id);
      delete timers[which];
    }
    if (!timeout_ms) return 0;
    var id = setTimeout(() => {
      assert(which in timers);
      delete timers[which];
      callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
    }, timeout_ms);
    timers[which] = { id, timeout_ms };
    return 0;
  };
  var abortOnCannotGrowMemory = requestedSize => {
    abort(
      `Cannot enlarge memory arrays to size ${requestedSize} bytes (OOM). Either (1) compile with -sINITIAL_MEMORY=X with X higher than the current value ${HEAP8.length}, (2) compile with -sALLOW_MEMORY_GROWTH which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with -sABORTING_MALLOC=0`
    );
  };
  var _emscripten_resize_heap = requestedSize => {
    var oldSize = HEAPU8.length;
    requestedSize >>>= 0;
    abortOnCannotGrowMemory(requestedSize);
  };
  var _fd_close = fd => {
    abort('fd_close called without SYSCALLS_REQUIRE_FILESYSTEM');
  };
  var INT53_MAX = 9007199254740992;
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = num => (num < INT53_MIN || num > INT53_MAX ? NaN : Number(num));
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
    return 70;
  }
  var printCharBuffers = [null, [], []];
  var printChar = (stream, curr) => {
    var buffer = printCharBuffers[stream];
    assert(buffer);
    if (curr === 0 || curr === 10) {
      (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
      buffer.length = 0;
    } else {
      buffer.push(curr);
    }
  };
  var flush_NO_FILESYSTEM = () => {
    _fflush(0);
    if (printCharBuffers[1].length) printChar(1, 10);
    if (printCharBuffers[2].length) printChar(2, 10);
  };
  var _fd_write = (fd, iov, iovcnt, pnum) => {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[(iov + 4) >> 2];
      iov += 8;
      for (var j = 0; j < len; j++) {
        printChar(fd, HEAPU8[ptr + j]);
      }
      num += len;
    }
    HEAPU32[pnum >> 2] = num;
    return 0;
  };
  var getCFunc = ident => {
    var func = Module['_' + ident];
    assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
    return func;
  };
  var writeArrayToMemory = (array, buffer) => {
    assert(
      array.length >= 0,
      'writeArrayToMemory array must have a length (should be an array or typed array)'
    );
    HEAP8.set(array, buffer);
  };
  var stackAlloc = sz => __emscripten_stack_alloc(sz);
  var stringToUTF8OnStack = str => {
    var size = lengthBytesUTF8(str) + 1;
    var ret = stackAlloc(size);
    stringToUTF8(str, ret, size);
    return ret;
  };
  var ccall = (ident, returnType, argTypes, args, opts) => {
    var toC = {
      string: str => {
        var ret = 0;
        if (str !== null && str !== undefined && str !== 0) {
          ret = stringToUTF8OnStack(str);
        }
        return ret;
      },
      array: arr => {
        var ret = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret);
        return ret;
      },
    };
    function convertReturnValue(ret) {
      if (returnType === 'string') {
        return UTF8ToString(ret);
      }
      if (returnType === 'boolean') return Boolean(ret);
      return ret;
    }
    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;
    assert(returnType !== 'array', 'Return type should not be "array".');
    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];
        if (converter) {
          if (stack === 0) stack = stackSave();
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }
    var ret = func(...cArgs);
    function onDone(ret) {
      if (stack !== 0) stackRestore(stack);
      return convertReturnValue(ret);
    }
    ret = onDone(ret);
    return ret;
  };
  var cwrap =
    (ident, returnType, argTypes, opts) =>
    (...args) =>
      ccall(ident, returnType, argTypes, args, opts);
  var maybeCStringToJsString = cString => (cString > 2 ? UTF8ToString(cString) : cString);
  var specialHTMLTargets = [0, document, window];
  var findEventTarget = target => {
    target = maybeCStringToJsString(target);
    var domElement = specialHTMLTargets[target] || document.querySelector(target);
    return domElement;
  };
  var findCanvasEventTarget = findEventTarget;
  var _emscripten_set_canvas_element_size = (target, width, height) => {
    var canvas = findCanvasEventTarget(target);
    if (!canvas) return -4;
    canvas.width = width;
    canvas.height = height;
    return 0;
  };
  init_ClassHandle();
  init_RegisteredPointer();
  assert(emval_handles.length === 5 * 2);
  {
    if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];
    if (Module['print']) out = Module['print'];
    if (Module['printErr']) err = Module['printErr'];
    if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];
    Module['FS_createDataFile'] = FS.createDataFile;
    Module['FS_createPreloadedFile'] = FS.createPreloadedFile;
    checkIncomingModuleAPI();
    if (Module['arguments']) arguments_ = Module['arguments'];
    if (Module['thisProgram']) thisProgram = Module['thisProgram'];
    assert(
      typeof Module['memoryInitializerPrefixURL'] == 'undefined',
      'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead'
    );
    assert(
      typeof Module['pthreadMainPrefixURL'] == 'undefined',
      'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead'
    );
    assert(
      typeof Module['cdInitializerPrefixURL'] == 'undefined',
      'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead'
    );
    assert(
      typeof Module['filePackagePrefixURL'] == 'undefined',
      'Module.filePackagePrefixURL option was removed, use Module.locateFile instead'
    );
    assert(typeof Module['read'] == 'undefined', 'Module.read option was removed');
    assert(
      typeof Module['readAsync'] == 'undefined',
      'Module.readAsync option was removed (modify readAsync in JS)'
    );
    assert(
      typeof Module['readBinary'] == 'undefined',
      'Module.readBinary option was removed (modify readBinary in JS)'
    );
    assert(
      typeof Module['setWindowTitle'] == 'undefined',
      'Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)'
    );
    assert(
      typeof Module['TOTAL_MEMORY'] == 'undefined',
      'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY'
    );
    assert(
      typeof Module['ENVIRONMENT'] == 'undefined',
      'Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)'
    );
    assert(
      typeof Module['STACK_SIZE'] == 'undefined',
      'STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time'
    );
    assert(
      typeof Module['wasmMemory'] == 'undefined',
      'Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally'
    );
    assert(
      typeof Module['INITIAL_MEMORY'] == 'undefined',
      'Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically'
    );
  }
  Module['ccall'] = ccall;
  Module['cwrap'] = cwrap;
  var missingLibrarySymbols = [
    'writeI53ToI64',
    'writeI53ToI64Clamped',
    'writeI53ToI64Signaling',
    'writeI53ToU64Clamped',
    'writeI53ToU64Signaling',
    'readI53FromI64',
    'readI53FromU64',
    'convertI32PairToI53',
    'convertI32PairToI53Checked',
    'convertU32PairToI53',
    'getTempRet0',
    'setTempRet0',
    'zeroMemory',
    'getHeapMax',
    'growMemory',
    'withStackSave',
    'strError',
    'inetPton4',
    'inetNtop4',
    'inetPton6',
    'inetNtop6',
    'readSockaddr',
    'writeSockaddr',
    'readEmAsmArgs',
    'jstoi_q',
    'getExecutableName',
    'autoResumeAudioContext',
    'getDynCaller',
    'dynCall',
    'runtimeKeepalivePush',
    'runtimeKeepalivePop',
    'asmjsMangle',
    'asyncLoad',
    'alignMemory',
    'mmapAlloc',
    'HandleAllocator',
    'getNativeTypeSize',
    'getUniqueRunDependency',
    'addOnInit',
    'addOnPostCtor',
    'addOnPreMain',
    'addOnExit',
    'STACK_SIZE',
    'STACK_ALIGN',
    'POINTER_SIZE',
    'ASSERTIONS',
    'convertJsFunctionToWasm',
    'getEmptyTableSlot',
    'updateTableMap',
    'getFunctionAddress',
    'addFunction',
    'removeFunction',
    'intArrayFromString',
    'intArrayToString',
    'stringToAscii',
    'stringToNewUTF8',
    'registerKeyEventCallback',
    'getBoundingClientRect',
    'fillMouseEventData',
    'registerMouseEventCallback',
    'registerWheelEventCallback',
    'registerUiEventCallback',
    'registerFocusEventCallback',
    'fillDeviceOrientationEventData',
    'registerDeviceOrientationEventCallback',
    'fillDeviceMotionEventData',
    'registerDeviceMotionEventCallback',
    'screenOrientation',
    'fillOrientationChangeEventData',
    'registerOrientationChangeEventCallback',
    'fillFullscreenChangeEventData',
    'registerFullscreenChangeEventCallback',
    'JSEvents_requestFullscreen',
    'JSEvents_resizeCanvasForFullscreen',
    'registerRestoreOldStyle',
    'hideEverythingExceptGivenElement',
    'restoreHiddenElements',
    'setLetterbox',
    'softFullscreenResizeWebGLRenderTarget',
    'doRequestFullscreen',
    'fillPointerlockChangeEventData',
    'registerPointerlockChangeEventCallback',
    'registerPointerlockErrorEventCallback',
    'requestPointerLock',
    'fillVisibilityChangeEventData',
    'registerVisibilityChangeEventCallback',
    'registerTouchEventCallback',
    'fillGamepadEventData',
    'registerGamepadEventCallback',
    'registerBeforeUnloadEventCallback',
    'fillBatteryEventData',
    'registerBatteryEventCallback',
    'setCanvasElementSize',
    'getCanvasElementSize',
    'jsStackTrace',
    'getCallstack',
    'convertPCtoSourceLocation',
    'getEnvStrings',
    'checkWasiClock',
    'wasiRightsToMuslOFlags',
    'wasiOFlagsToMuslOFlags',
    'initRandomFill',
    'randomFill',
    'safeSetTimeout',
    'setImmediateWrapped',
    'safeRequestAnimationFrame',
    'clearImmediateWrapped',
    'registerPostMainLoop',
    'registerPreMainLoop',
    'getPromise',
    'makePromise',
    'idsToPromises',
    'makePromiseCallback',
    'findMatchingCatch',
    'Browser_asyncPrepareDataCounter',
    'isLeapYear',
    'ydayFromDate',
    'arraySum',
    'addDays',
    'getSocketFromFD',
    'getSocketAddress',
    'FS_createPreloadedFile',
    'FS_modeStringToFlags',
    'FS_getMode',
    'FS_stdin_getChar',
    'FS_mkdirTree',
    '_setNetworkCallback',
    'heapObjectForWebGLType',
    'toTypedArrayIndex',
    'webgl_enable_ANGLE_instanced_arrays',
    'webgl_enable_OES_vertex_array_object',
    'webgl_enable_WEBGL_draw_buffers',
    'webgl_enable_WEBGL_multi_draw',
    'webgl_enable_EXT_polygon_offset_clamp',
    'webgl_enable_EXT_clip_control',
    'webgl_enable_WEBGL_polygon_mode',
    'emscriptenWebGLGet',
    'computeUnpackAlignedImageSize',
    'colorChannelsInGlTextureFormat',
    'emscriptenWebGLGetTexPixelData',
    'emscriptenWebGLGetUniform',
    'webglGetUniformLocation',
    'webglPrepareUniformLocationsBeforeFirstUse',
    'webglGetLeftBracePos',
    'emscriptenWebGLGetVertexAttrib',
    '__glGetActiveAttribOrUniform',
    'writeGLArray',
    'registerWebGlEventCallback',
    'runAndAbortIfError',
    'ALLOC_NORMAL',
    'ALLOC_STACK',
    'allocate',
    'writeStringToMemory',
    'writeAsciiToMemory',
    'demangle',
    'stackTrace',
    'getFunctionArgsName',
    'createJsInvokerSignature',
    'PureVirtualError',
    'registerInheritedInstance',
    'unregisterInheritedInstance',
    'getInheritedInstanceCount',
    'getLiveInheritedInstances',
    'enumReadValueFromPointer',
    'setDelayFunction',
    'validateThis',
    'count_emval_handles',
  ];
  missingLibrarySymbols.forEach(missingLibrarySymbol);
  var unexportedSymbols = [
    'run',
    'addRunDependency',
    'removeRunDependency',
    'out',
    'err',
    'callMain',
    'abort',
    'wasmMemory',
    'wasmExports',
    'HEAPF64',
    'HEAP8',
    'HEAPU8',
    'HEAP16',
    'HEAPU16',
    'HEAP32',
    'HEAPU32',
    'HEAP64',
    'HEAPU64',
    'writeStackCookie',
    'checkStackCookie',
    'INT53_MAX',
    'INT53_MIN',
    'bigintToI53Checked',
    'stackSave',
    'stackRestore',
    'stackAlloc',
    'ptrToString',
    'exitJS',
    'abortOnCannotGrowMemory',
    'ENV',
    'ERRNO_CODES',
    'DNS',
    'Protocols',
    'Sockets',
    'timers',
    'warnOnce',
    'readEmAsmArgsArray',
    'handleException',
    'keepRuntimeAlive',
    'callUserCallback',
    'maybeExit',
    'wasmTable',
    'noExitRuntime',
    'addOnPreRun',
    'addOnPostRun',
    'freeTableIndexes',
    'functionsInTableMap',
    'setValue',
    'getValue',
    'PATH',
    'PATH_FS',
    'UTF8Decoder',
    'UTF8ArrayToString',
    'UTF8ToString',
    'stringToUTF8Array',
    'stringToUTF8',
    'lengthBytesUTF8',
    'AsciiToString',
    'UTF16Decoder',
    'UTF16ToString',
    'stringToUTF16',
    'lengthBytesUTF16',
    'UTF32ToString',
    'stringToUTF32',
    'lengthBytesUTF32',
    'stringToUTF8OnStack',
    'writeArrayToMemory',
    'JSEvents',
    'specialHTMLTargets',
    'maybeCStringToJsString',
    'findEventTarget',
    'findCanvasEventTarget',
    'currentFullscreenStrategy',
    'restoreOldWindowedStyle',
    'UNWIND_CACHE',
    'ExitStatus',
    'flush_NO_FILESYSTEM',
    'emSetImmediate',
    'emClearImmediate_deps',
    'emClearImmediate',
    'promiseMap',
    'uncaughtExceptionCount',
    'exceptionLast',
    'exceptionCaught',
    'ExceptionInfo',
    'Browser',
    'requestFullscreen',
    'requestFullScreen',
    'setCanvasSize',
    'getUserMedia',
    'createContext',
    'getPreloadedImageData__data',
    'wget',
    'MONTH_DAYS_REGULAR',
    'MONTH_DAYS_LEAP',
    'MONTH_DAYS_REGULAR_CUMULATIVE',
    'MONTH_DAYS_LEAP_CUMULATIVE',
    'SYSCALLS',
    'preloadPlugins',
    'FS_stdin_getChar_buffer',
    'FS_unlink',
    'FS_createPath',
    'FS_createDevice',
    'FS_readFile',
    'FS',
    'FS_root',
    'FS_mounts',
    'FS_devices',
    'FS_streams',
    'FS_nextInode',
    'FS_nameTable',
    'FS_currentPath',
    'FS_initialized',
    'FS_ignorePermissions',
    'FS_filesystems',
    'FS_syncFSRequests',
    'FS_readFiles',
    'FS_lookupPath',
    'FS_getPath',
    'FS_hashName',
    'FS_hashAddNode',
    'FS_hashRemoveNode',
    'FS_lookupNode',
    'FS_createNode',
    'FS_destroyNode',
    'FS_isRoot',
    'FS_isMountpoint',
    'FS_isFile',
    'FS_isDir',
    'FS_isLink',
    'FS_isChrdev',
    'FS_isBlkdev',
    'FS_isFIFO',
    'FS_isSocket',
    'FS_flagsToPermissionString',
    'FS_nodePermissions',
    'FS_mayLookup',
    'FS_mayCreate',
    'FS_mayDelete',
    'FS_mayOpen',
    'FS_checkOpExists',
    'FS_nextfd',
    'FS_getStreamChecked',
    'FS_getStream',
    'FS_createStream',
    'FS_closeStream',
    'FS_dupStream',
    'FS_doSetAttr',
    'FS_chrdev_stream_ops',
    'FS_major',
    'FS_minor',
    'FS_makedev',
    'FS_registerDevice',
    'FS_getDevice',
    'FS_getMounts',
    'FS_syncfs',
    'FS_mount',
    'FS_unmount',
    'FS_lookup',
    'FS_mknod',
    'FS_statfs',
    'FS_statfsStream',
    'FS_statfsNode',
    'FS_create',
    'FS_mkdir',
    'FS_mkdev',
    'FS_symlink',
    'FS_rename',
    'FS_rmdir',
    'FS_readdir',
    'FS_readlink',
    'FS_stat',
    'FS_fstat',
    'FS_lstat',
    'FS_doChmod',
    'FS_chmod',
    'FS_lchmod',
    'FS_fchmod',
    'FS_doChown',
    'FS_chown',
    'FS_lchown',
    'FS_fchown',
    'FS_doTruncate',
    'FS_truncate',
    'FS_ftruncate',
    'FS_utime',
    'FS_open',
    'FS_close',
    'FS_isClosed',
    'FS_llseek',
    'FS_read',
    'FS_write',
    'FS_mmap',
    'FS_msync',
    'FS_ioctl',
    'FS_writeFile',
    'FS_cwd',
    'FS_chdir',
    'FS_createDefaultDirectories',
    'FS_createDefaultDevices',
    'FS_createSpecialDirectories',
    'FS_createStandardStreams',
    'FS_staticInit',
    'FS_init',
    'FS_quit',
    'FS_findObject',
    'FS_analyzePath',
    'FS_createFile',
    'FS_createDataFile',
    'FS_forceLoadFile',
    'FS_createLazyFile',
    'FS_absolutePath',
    'FS_createFolder',
    'FS_createLink',
    'FS_joinPath',
    'FS_mmapAlloc',
    'FS_standardizePath',
    'MEMFS',
    'TTY',
    'PIPEFS',
    'SOCKFS',
    'tempFixedLengthArray',
    'miniTempWebGLFloatBuffers',
    'miniTempWebGLIntBuffers',
    'GL',
    'AL',
    'GLUT',
    'EGL',
    'GLEW',
    'IDBStore',
    'SDL',
    'SDL_gfx',
    'allocateUTF8',
    'allocateUTF8OnStack',
    'print',
    'printErr',
    'jstoi_s',
    'InternalError',
    'BindingError',
    'throwInternalError',
    'throwBindingError',
    'registeredTypes',
    'awaitingDependencies',
    'typeDependencies',
    'tupleRegistrations',
    'structRegistrations',
    'sharedRegisterType',
    'whenDependentTypesAreResolved',
    'getTypeName',
    'getFunctionName',
    'heap32VectorToArray',
    'requireRegisteredType',
    'usesDestructorStack',
    'checkArgCount',
    'getRequiredArgCount',
    'createJsInvoker',
    'UnboundTypeError',
    'EmValType',
    'EmValOptionalType',
    'throwUnboundTypeError',
    'ensureOverloadTable',
    'exposePublicSymbol',
    'replacePublicSymbol',
    'createNamedFunction',
    'embindRepr',
    'registeredInstances',
    'getBasestPointer',
    'getInheritedInstance',
    'registeredPointers',
    'registerType',
    'integerReadValueFromPointer',
    'floatReadValueFromPointer',
    'assertIntegerRange',
    'readPointer',
    'runDestructors',
    'craftInvokerFunction',
    'embind__requireFunction',
    'genericPointerToWireType',
    'constNoSmartPtrRawPointerToWireType',
    'nonConstNoSmartPtrRawPointerToWireType',
    'init_RegisteredPointer',
    'RegisteredPointer',
    'RegisteredPointer_fromWireType',
    'runDestructor',
    'releaseClassHandle',
    'finalizationRegistry',
    'detachFinalizer_deps',
    'detachFinalizer',
    'attachFinalizer',
    'makeClassHandle',
    'init_ClassHandle',
    'ClassHandle',
    'throwInstanceAlreadyDeleted',
    'deletionQueue',
    'flushPendingDeletes',
    'delayFunction',
    'RegisteredClass',
    'shallowCopyInternalPointer',
    'downcastPointer',
    'upcastPointer',
    'char_0',
    'char_9',
    'makeLegalFunctionName',
    'emval_freelist',
    'emval_handles',
    'emval_symbols',
    'getStringOrSymbol',
    'Emval',
    'emval_get_global',
    'emval_returnValue',
    'emval_lookupTypes',
    'emval_methodCallers',
    'emval_addMethodCaller',
  ];
  unexportedSymbols.forEach(unexportedRuntimeSymbol);
  Module['_emscripten_set_canvas_element_size'] = _emscripten_set_canvas_element_size;
  function checkIncomingModuleAPI() {
    ignoredModuleProp('fetchSettings');
  }
  var _posix_memalign = (Module['_posix_memalign'] = makeInvalidEarlyAccess('_posix_memalign'));
  var _free = (Module['_free'] = makeInvalidEarlyAccess('_free'));
  var _malloc = (Module['_malloc'] = makeInvalidEarlyAccess('_malloc'));
  var ___getTypeName = makeInvalidEarlyAccess('___getTypeName');
  var _fflush = makeInvalidEarlyAccess('_fflush');
  var _emscripten_stack_get_end = makeInvalidEarlyAccess('_emscripten_stack_get_end');
  var _emscripten_stack_get_base = makeInvalidEarlyAccess('_emscripten_stack_get_base');
  var __emscripten_timeout = makeInvalidEarlyAccess('__emscripten_timeout');
  var _strerror = makeInvalidEarlyAccess('_strerror');
  var _emscripten_stack_init = makeInvalidEarlyAccess('_emscripten_stack_init');
  var _emscripten_stack_get_free = makeInvalidEarlyAccess('_emscripten_stack_get_free');
  var __emscripten_stack_restore = makeInvalidEarlyAccess('__emscripten_stack_restore');
  var __emscripten_stack_alloc = makeInvalidEarlyAccess('__emscripten_stack_alloc');
  var _emscripten_stack_get_current = makeInvalidEarlyAccess('_emscripten_stack_get_current');
  var ___cxa_increment_exception_refcount = makeInvalidEarlyAccess(
    '___cxa_increment_exception_refcount'
  );
  function assignWasmExports(wasmExports) {
    Module['_posix_memalign'] = _posix_memalign = createExportWrapper('posix_memalign', 3);
    Module['_free'] = _free = createExportWrapper('free', 1);
    Module['_malloc'] = _malloc = createExportWrapper('malloc', 1);
    ___getTypeName = createExportWrapper('__getTypeName', 1);
    _fflush = createExportWrapper('fflush', 1);
    _emscripten_stack_get_end = wasmExports['emscripten_stack_get_end'];
    _emscripten_stack_get_base = wasmExports['emscripten_stack_get_base'];
    __emscripten_timeout = createExportWrapper('_emscripten_timeout', 2);
    _strerror = createExportWrapper('strerror', 1);
    _emscripten_stack_init = wasmExports['emscripten_stack_init'];
    _emscripten_stack_get_free = wasmExports['emscripten_stack_get_free'];
    __emscripten_stack_restore = wasmExports['_emscripten_stack_restore'];
    __emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'];
    _emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'];
    ___cxa_increment_exception_refcount = createExportWrapper(
      '__cxa_increment_exception_refcount',
      1
    );
  }
  var wasmImports = {
    __cxa_throw: ___cxa_throw,
    _abort_js: __abort_js,
    _embind_finalize_value_array: __embind_finalize_value_array,
    _embind_finalize_value_object: __embind_finalize_value_object,
    _embind_register_bigint: __embind_register_bigint,
    _embind_register_bool: __embind_register_bool,
    _embind_register_class: __embind_register_class,
    _embind_register_class_constructor: __embind_register_class_constructor,
    _embind_register_class_function: __embind_register_class_function,
    _embind_register_emval: __embind_register_emval,
    _embind_register_float: __embind_register_float,
    _embind_register_integer: __embind_register_integer,
    _embind_register_memory_view: __embind_register_memory_view,
    _embind_register_optional: __embind_register_optional,
    _embind_register_std_string: __embind_register_std_string,
    _embind_register_std_wstring: __embind_register_std_wstring,
    _embind_register_value_array: __embind_register_value_array,
    _embind_register_value_array_element: __embind_register_value_array_element,
    _embind_register_value_object: __embind_register_value_object,
    _embind_register_value_object_field: __embind_register_value_object_field,
    _embind_register_void: __embind_register_void,
    _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
    _emval_create_invoker: __emval_create_invoker,
    _emval_decref: __emval_decref,
    _emval_get_global: __emval_get_global,
    _emval_incref: __emval_incref,
    _emval_invoke: __emval_invoke,
    _emval_new_cstring: __emval_new_cstring,
    _emval_new_object: __emval_new_object,
    _emval_run_destructors: __emval_run_destructors,
    _emval_set_property: __emval_set_property,
    _setitimer_js: __setitimer_js,
    emscripten_get_now: _emscripten_get_now,
    emscripten_resize_heap: _emscripten_resize_heap,
    fd_close: _fd_close,
    fd_seek: _fd_seek,
    fd_write: _fd_write,
    proc_exit: _proc_exit,
  };
  var wasmExports = await createWasm();
  var calledRun;
  function stackCheckInit() {
    _emscripten_stack_init();
    writeStackCookie();
  }
  function run() {
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    stackCheckInit();
    preRun();
    if (runDependencies > 0) {
      dependenciesFulfilled = run;
      return;
    }
    function doRun() {
      assert(!calledRun);
      calledRun = true;
      Module['calledRun'] = true;
      if (ABORT) return;
      initRuntime();
      readyPromiseResolve?.(Module);
      Module['onRuntimeInitialized']?.();
      consumedModuleProp('onRuntimeInitialized');
      assert(
        !Module['_main'],
        'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]'
      );
      postRun();
    }
    if (Module['setStatus']) {
      Module['setStatus']('Running...');
      setTimeout(() => {
        setTimeout(() => Module['setStatus'](''), 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
    checkStackCookie();
  }
  function checkUnflushedContent() {
    var oldOut = out;
    var oldErr = err;
    var has = false;
    out = err = x => {
      has = true;
    };
    try {
      flush_NO_FILESYSTEM();
    } catch (e) {}
    out = oldOut;
    err = oldErr;
    if (has) {
      warnOnce(
        'stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.'
      );
      warnOnce(
        '(this may also be due to not including full filesystem support - try building with -sFORCE_FILESYSTEM)'
      );
    }
  }
  function preInit() {
    if (Module['preInit']) {
      if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
      while (Module['preInit'].length > 0) {
        Module['preInit'].shift()();
      }
    }
    consumedModuleProp('preInit');
  }
  preInit();
  run();
  if (runtimeInitialized) {
    moduleRtn = Module;
  } else {
    moduleRtn = new Promise((resolve, reject) => {
      readyPromiseResolve = resolve;
      readyPromiseReject = reject;
    });
  }
  for (const prop of Object.keys(Module)) {
    if (!(prop in moduleArg)) {
      Object.defineProperty(moduleArg, prop, {
        configurable: true,
        get() {
          abort(
            `Access to module property ('${prop}') is no longer possible via the module constructor argument; Instead, use the result of the module constructor.`
          );
        },
      });
    }
  }
  return moduleRtn;
}
export default createModule;
