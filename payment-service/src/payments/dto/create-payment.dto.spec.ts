import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePaymentDto } from './create-payment.dto';

function errorsFor(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreatePaymentDto, body);
  return validateSync(dto).map((error) => error.property);
}

const valid = {
  orderId: 'PED-1',
  customerId: 'CLI-1',
  customerEmail: 'cliente@exemplo.com',
  amount: 259.9,
};

describe('CreatePaymentDto', () => {
  it('aceita um pedido válido', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it.each([
    ['valor zero', { amount: 0 }, 'amount'],
    ['valor negativo', { amount: -10 }, 'amount'],
    ['mais de 2 casas decimais', { amount: 10.999 }, 'amount'],
    ['valor como texto', { amount: '10' }, 'amount'],
    ['e-mail inválido', { customerEmail: 'sem-arroba' }, 'customerEmail'],
    ['pedido vazio', { orderId: '' }, 'orderId'],
  ])('rejeita %s', (_caso, override, field) => {
    expect(errorsFor({ ...valid, ...override })).toContain(field);
  });
});
