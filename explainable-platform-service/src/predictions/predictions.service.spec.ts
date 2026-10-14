import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PredictionsService } from './predictions.service';
import { PredictionStatus } from '../interface/prediction-class.enum';

const csv = (text: string) => ({ buffer: Buffer.from(text) }) as any;

function build(productionVersion: () => Promise<string | null>) {
  const saved: { predictions: any[]; records: any[] } = {
    predictions: [],
    records: [],
  };
  const latest = () => ({
    orderBy: () => ({ limit: () => ({ getOne: async () => null }) }),
  });
  const predictionsRepository = {
    createQueryBuilder: latest,
    create: (x: any) => x,
    save: jest.fn(async (x: any) => saved.predictions.push(x)),
  };
  const recordsRepository = {
    createQueryBuilder: latest,
    create: (x: any) => x,
    save: jest.fn(async (x: any) => saved.records.push(x)),
    find: jest.fn(async () => saved.records),
  };
  const queue = {
    addPredictionJob: jest.fn(async () => undefined),
    addPredictionRecordJob: jest.fn(async () => undefined),
  };
  const models = { fetchProductionVersion: jest.fn(productionVersion) };
  const events = { publishPrediction: jest.fn() };

  const service = new PredictionsService(
    predictionsRepository as any,
    recordsRepository as any,
    queue as any,
    { getPresignedUrl: async () => null } as any,
    events as any,
    models as any,
  );
  return { service, saved, queue, models, recordsRepository };
}

describe('PredictionsService.createPrediction', () => {
  it('pins the prediction to the version in Production when it is submitted', async () => {
    const { service, saved, models } = build(async () => '4');

    await service.createPrediction(csv('id,a\ns1,1\ns2,2\n'), 'crc');

    expect(models.fetchProductionVersion).toHaveBeenCalledTimes(1);
    expect(models.fetchProductionVersion).toHaveBeenCalledWith('crc');
    expect(saved.predictions).toHaveLength(1);
    expect(saved.predictions[0]).toMatchObject({
      modelName: 'crc',
      modelVersion: '4',
    });
  });

  it('refuses a model with nothing in Production, before saving anything', async () => {
    const { service, saved, queue } = build(async () => null);

    await expect(
      service.createPrediction(csv('id,a\ns1,1\n'), 'crc'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createPrediction(csv('id,a\ns1,1\n'), 'crc'),
    ).rejects.toThrow(/"crc" has no published version/);
    expect(saved.predictions).toHaveLength(0);
    expect(queue.addPredictionJob).not.toHaveBeenCalled();
  });

  it('refuses rather than guessing when the registry cannot be reached', async () => {
    const { service, saved } = build(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      service.createPrediction(csv('id,a\ns1,1\n'), 'crc'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(saved.predictions).toHaveLength(0);
  });

  it('does not ask the registry for a file it rejects anyway', async () => {
    const { service, models } = build(async () => '4');

    await expect(
      service.createPrediction(csv('id,a\n'), 'crc'),
    ).rejects.toThrow(BadRequestException);
    expect(models.fetchProductionVersion).not.toHaveBeenCalled();
  });
});

describe('PredictionsService.rePredictRecords', () => {
  it('re-queues failed records without resolving a new version', async () => {
    const { service, models, queue, recordsRepository } = build(
      async () => '9',
    );
    recordsRepository.find.mockResolvedValueOnce([
      { id: 'r1', status: PredictionStatus.ERROR, modelVersion: '4' },
    ] as any);

    await service.rePredictRecords('p1');

    expect(models.fetchProductionVersion).not.toHaveBeenCalled();
    expect(queue.addPredictionRecordJob).toHaveBeenCalledWith('p1', 'r1');
  });
});
