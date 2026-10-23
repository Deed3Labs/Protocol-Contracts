// The data loads first and in the prototype's order (every function it calls is a hoisted
// declaration, so no file is seen half-loaded). Then the prototype's start-up statements run.
import './data';
export { startup } from './startup';
