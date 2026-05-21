# TypeScript with the Interactivity API

`store()` infers types from the object you pass in. Add explicit types for server-defined state (which isn't visible to TS), local context, and complex/multi-block stores.

## Infer from the client store

```ts
const { state } = store( 'my-plugin/x', {
  state: { counter: 0 },
  actions: {
    increment() { state.counter += 1; },
  },
} );
// state.counter: number, actions.increment(): void
```

## Type server state, infer the rest

When some state is initialized in PHP, TS can't see it. Declare it:

```ts
type ServerState = { state: { counter: number } };

const storeDef = {
  actions: { increment() { state.counter += 1; } },
};

type Store = ServerState & typeof storeDef;

const { state } = store< Store >( 'my-plugin/x', storeDef );
```

Or cast on `state`:

```ts
type State = { counter: number; product: number };

const { state } = store( 'my-plugin/x', {
  state: { product: 2 } as State,
  actions: { increment() { state.counter += state.product; } },
} );
```

## Typing local context

`data-wp-context` isn't visible to TS. Pass the type to `getContext()`:

```ts
type MyContext = { counter: number };

actions: {
  increment() {
    const context = getContext< MyContext >();
    context.counter += 1;
  },
}
```

## Typing derived getters

A getter that reads `state` creates a circular reference. Add a return type to break it:

```ts
state: {
  counter: 1,
  get double(): number { return state.counter * 2; },
}
```

Getters that read only `getContext()` don't need this annotation.

## Typing async actions

Async actions are generators; callers see `Promise<ReturnType>`.

```ts
actions: {
  *delayedIncrement() {
    yield new Promise( ( r ) => setTimeout( r, 1000 ) );
    state.counter += 1;
  },
}
// actions.delayedIncrement: () => Promise<void>
```

### `AsyncAction<T>` for circular references in yields

If an async action yields something derived from `state` and TS bails to `any`:

```ts
import { type AsyncAction } from '@wordpress/interactivity';

actions: {
  *delayed(): AsyncAction< number > {
    yield fetchCounterData( state.counter );
    return state.counter + 1;
  },
}
```

### `TypeYield<T>` to type a yield's result

Yielded promises resolve to `any` by default:

```ts
import { type AsyncAction, type TypeYield } from '@wordpress/interactivity';

actions: {
  *load(): AsyncAction< void > {
    const data = ( yield fetchCounterData( state.counter ) ) as TypeYield< typeof fetchCounterData >;
    state.counter = data.next;
  },
}
```

## Multi-block stores under one namespace

Export types so other files can import them:

```ts
// todo-list/view.ts
type ServerState = { state: { todos: string[]; filter: 'all' | 'completed' } };

const todoList = {
  state: {
    get filtered(): string[] {
      return state.filter === 'completed' ? state.todos.filter( done ) : state.todos;
    },
  },
  actions: { addTodo( t: string ) { state.todos.push( t ); } },
};

export type TodoList = ServerState & typeof todoList;

const { state } = store< TodoList >( 'my-plugin/todos', todoList );
```

```ts
// add-post-to-todo/view.ts
import type { TodoList } from '../todo-list/view';

type ServerState = { state: { postTitle: string } };
type Store = TodoList & ServerState & typeof addPostToTodo;

const { state, actions } = store< Store >( 'my-plugin/todos', addPostToTodo );
```
